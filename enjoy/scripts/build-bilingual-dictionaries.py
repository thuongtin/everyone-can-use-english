"""Build versioned, read-only bilingual databases from Kaikki JSONL snapshots."""
import argparse
import collections
import gzip
import hashlib
import json
import sqlite3
import unicodedata
from pathlib import Path
from urllib.parse import quote


def clean(text):
    return unicodedata.normalize('NFC', text).replace(chr(0x2014), ' - ')


def key(word):
    return ' '.join(clean(word).lower().split())


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(source, output, direction, source_url, dump_date, extraction_date):
    language, edition = ('en', 'vi') if direction == 'en-vi' else ('vi', 'en')
    corrections_path = Path(__file__).resolve().parents[1] / 'dictionaries/editorial-corrections.json'
    corrections = json.loads(corrections_path.read_text()).get(direction, {})
    words = collections.defaultdict(list)
    counts = collections.Counter()
    opener = gzip.open if source.suffix == '.gz' else open
    with opener(source, 'rt', encoding='utf-8') as stream:
        for line in stream:
            item = json.loads(line)
            if item.get('lang_code') != language:
                continue
            word = clean(item['word'])
            # This learner edition indexes Latin-script headwords, not Han/Nom characters.
            if not any('LATIN' in unicodedata.name(c, '') for c in word) or any(
                c.isalpha() and 'LATIN' not in unicodedata.name(c, '') for c in word
            ) or item.get('pos') == 'character':
                counts['excludedNonLatinOrCharacterEntries'] += 1
                continue
            senses = []
            for sense in item.get('senses', []):
                glosses = [clean(g) for g in sense.get('glosses', []) if g.strip()]
                if not glosses:
                    counts['excludedEmptySenses'] += 1
                    continue
                examples = []
                for example in sense.get('examples', []):
                    # Quoted publications and media require separate rights review.
                    if direction == 'vi-en' or example.get('ref') or example.get('type', 'example') != 'example':
                        counts['excludedQuotations'] += 1
                        continue
                    if example.get('text'):
                        examples.append({
                            'text': clean(example['text']),
                            'translation': clean(example.get('translation') or example.get('english') or ''),
                        })
                senses.append({'glosses': glosses, 'tags': sense.get('tags', []), 'examples': examples})
            if not senses:
                counts['excludedEmptyEntries'] += 1
                continue
            entry = {
                'word': word, 'pos': item.get('pos', 'unknown'),
                'senses': senses,
                'ipa': [
                    {'text': clean(sound['ipa']), 'labels': [clean(tag) for tag in
                        [*sound.get('tags', []), *sound.get('raw_tags', []), *([sound['note']] if sound.get('note') else [])]]}
                    for sound in item.get('sounds', []) if sound.get('ipa')
                ],
                'sourceUrl': f'https://{edition}.wiktionary.org/wiki/{quote(word.replace(" ", "_"), safe="")}#{"Tiếng_Anh" if edition == "vi" else "Vietnamese"}',
            }
            correction = corrections.get(word)
            if correction:
                replacements = correction.get('replaceGlosses', {})
                matched = 0
                for sense in entry['senses']:
                    matched += sum(gloss in replacements for gloss in sense['glosses'])
                    sense['glosses'] = [replacements.get(gloss, gloss) for gloss in sense['glosses']]
                if matched != len(replacements):
                    raise ValueError(f'Editorial correction no longer matches source: {direction}/{word}')
                entry['ipa'] = correction.get('ipa', entry['ipa'])
                entry['editorialNote'] = correction['note']
                entry['editorialSourceUrl'] = correction['sourceUrl']
                counts['editoriallyCorrectedEntries'] += 1
            words[key(word)].append(entry)
            counts['entries'] += 1
            counts['senses'] += len(senses)
    output.mkdir(parents=True, exist_ok=True)
    temporary = output / f'{direction}.building.sqlite'
    if temporary.exists():
        temporary.unlink()
    connection = sqlite3.connect(temporary)
    connection.execute('CREATE TABLE entries (word TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID')
    connection.executemany('INSERT INTO entries VALUES (?, ?)', (
        (word, json.dumps(entries, ensure_ascii=False, separators=(',', ':')))
        for word, entries in sorted(words.items())
    ))
    connection.commit()
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    connection.close()
    target = output / f'{direction}.sqlite.gz'
    with open(temporary, 'rb') as src, open(target, 'wb') as dest:
        with gzip.GzipFile(filename='', mode='wb', fileobj=dest, mtime=0) as compressed:
            while chunk := src.read(1024 * 1024):
                compressed.write(chunk)
    result = {
        'direction': direction, 'file': target.name, 'sha256': digest(target),
        'databaseSha256': digest(temporary), 'databaseBytes': temporary.stat().st_size,
        'sourceUrl': source_url, 'sourceSha256': digest(source),
        'editorialCorrectionsSha256': digest(corrections_path),
        'dumpDate': dump_date, 'extractionDate': extraction_date,
        'words': len(words), **dict(counts),
    }
    temporary.unlink()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--en-vi', type=Path, required=True)
    parser.add_argument('--vi-en', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'dictionaries')
    args = parser.parse_args()
    entries = [
        build(args.en_vi, args.output, 'en-vi', 'https://kaikki.org/viwiktionary/raw-wiktextract-data.jsonl.gz', '2026-09-01', '2026-09-03'),
        build(args.vi_en, args.output, 'vi-en', 'https://kaikki.org/dictionary/Vietnamese/kaikki.org-dictionary-Vietnamese.jsonl', '2026-08-05', '2026-08-28'),
    ]
    manifest = {'schemaVersion': 1, 'license': 'CC-BY-SA-4.0', 'dictionaries': entries}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
