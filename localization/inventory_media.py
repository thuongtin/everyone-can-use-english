"""Inventory tracked and untracked media without reading unsafe paths."""

from collections import Counter
import base64
import binascii
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import sys
import zipfile

try:
    from .inventory_paths import (
        MEDIA_EXTENSIONS,
        TEXT_EXTENSIONS,
        UnsafePathError,
        classify_path,
        discover_paths,
        is_reference_path,
        is_sensitive,
        read_bytes,
    )
    from .media_reviews import apply_audio_language_audit, apply_reviews, apply_source_text_audit
except ImportError:
    from inventory_paths import (
        MEDIA_EXTENSIONS,
        TEXT_EXTENSIONS,
        UnsafePathError,
        classify_path,
        discover_paths,
        is_reference_path,
        is_sensitive,
        read_bytes,
    )
    from media_reviews import apply_audio_language_audit, apply_reviews, apply_source_text_audit


ROOT = Path(__file__).resolve().parents[1]
MEDIA = set(MEDIA_EXTENSIONS)
TEXT = set(TEXT_EXTENSIONS) | {'.ipynb', '.svg'}
HAN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff]')
MAX_ARCHIVE_MEMBER_BYTES = 100_000_000


def _kind_for_path(relative):
    return relative.suffix.lower() or 'file'


def _skipped_entry(identifier, reason, asset_kind=None, archive_member=False):
    if archive_member and reason == 'sensitive':
        kind = 'sensitive-archive-member'
        status = 'skipped-sensitive'
    elif archive_member and reason == 'symlink':
        kind = 'symlink-archive-member'
        status = 'skipped-symlink'
    else:
        kind = f'skipped-{reason}'
        status = f'skipped-{reason}'
    entry = {
        'path': identifier,
        'kind': kind,
        'references': [],
        'review_status': status,
        'review_evidence': ['Path metadata was inspected; content was not read or hashed.'],
    }
    if asset_kind:
        entry['asset_kind'] = asset_kind
    entry['han_in_path'] = bool(HAN.search(identifier))
    return entry


def _item(entries, identifier, data, kind, references=None):
    entry = {
        'path': identifier,
        'kind': kind,
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'references': references or [],
        'review_status': 'pending-content-review',
        'review_evidence': [],
        'han_in_path': bool(HAN.search(identifier)),
    }
    if kind in {'.svg', '.ipynb'}:
        entry['han_in_text'] = len(HAN.findall(data.decode('utf-8', errors='replace')))
    entries.append(entry)
    return entry


def _embedded(entries, issues, identifier, index, location, mime, payload):
    payload = ''.join(payload) if isinstance(payload, list) else payload
    if mime.startswith(('image/', 'audio/', 'video/')):
        try:
            data = payload.encode() if mime == 'image/svg+xml' else base64.b64decode(payload)
        except (ValueError, binascii.Error, TypeError) as error:
            issues.append({
                'path': identifier,
                'cell': index,
                'location': location,
                'issue': 'invalid-embedded-media',
                'error': str(error),
            })
            return
        entry = _item(entries, f'{identifier}#cell/{index}/{location}/{mime}', data, mime, [identifier])
        if mime == 'image/svg+xml':
            entry['han_in_text'] = len(HAN.findall(payload))
    elif isinstance(payload, str) and mime.startswith('text/') and HAN.search(payload):
        issues.append({
            'path': identifier,
            'cell': index,
            'location': location,
            'issue': 'han-in-rich-output',
            'mime': mime,
            'count': len(HAN.findall(payload)),
        })


def _notebook(entries, issues, identifier, data):
    try:
        value = json.loads(data)
        for index, cell in enumerate(value.get('cells', [])):
            source = cell.get('source', [])
            source = ''.join(source) if isinstance(source, list) else source
            if isinstance(source, str) and HAN.search(source):
                issues.append({
                    'path': identifier,
                    'cell': index,
                    'issue': 'han-in-cell-source',
                    'count': len(HAN.findall(source)),
                })
            for name, bundle in cell.get('attachments', {}).items():
                for mime, payload in bundle.items():
                    _embedded(entries, issues, identifier, index, f'attachment/{name}', mime, payload)
            for output_index, output in enumerate(cell.get('outputs', [])):
                for mime, payload in output.get('data', {}).items():
                    _embedded(entries, issues, identifier, index, f'output/{output_index}', mime, payload)
                output_text = output.get('text', [])
                output_text = ''.join(output_text) if isinstance(output_text, list) else output_text
                if isinstance(output_text, str) and HAN.search(output_text):
                    issues.append({
                        'path': identifier,
                        'cell': index,
                        'output': output_index,
                        'issue': 'han-in-text-output',
                        'count': len(HAN.findall(output_text)),
                    })
    except (UnicodeDecodeError, ValueError, TypeError, AttributeError) as error:
        issues.append({'path': identifier, 'issue': 'notebook-parse-error', 'error': str(error)})


def _archive_member_is_symlink(member):
    mode = (member.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def _archive(entries, issues, identifier, data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        issues.append({'path': identifier, 'issue': 'archive-parse-error', 'error': str(error)})
        return

    with archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            member_path = Path(member.filename)
            member_identifier = f'{identifier}!/{member.filename}'
            if is_sensitive(member_path):
                entries.append(_skipped_entry(member_identifier, 'sensitive', archive_member=True))
                continue
            if _archive_member_is_symlink(member):
                entries.append(_skipped_entry(member_identifier, 'symlink', archive_member=True))
                continue
            if member.file_size > MAX_ARCHIVE_MEMBER_BYTES:
                issues.append({
                    'path': identifier,
                    'member': member.filename,
                    'issue': 'member-too-large-for-inspection',
                })
                continue
            metadata = '__MACOSX' in member_path.parts or member_path.name.startswith('._') or member_path.name == '.DS_Store'
            if metadata:
                entries.append({
                    'path': member_identifier,
                    'kind': 'archive-metadata',
                    'bytes': member.file_size,
                    'references': [identifier],
                    'review_status': 'excluded-metadata',
                    'review_evidence': ['Archive directory metadata only; content was not read.'],
                    'han_in_path': bool(HAN.search(member.filename)),
                })
                continue
            try:
                payload = archive.read(member)
            except (OSError, RuntimeError, zipfile.BadZipFile) as error:
                issues.append({
                    'path': identifier,
                    'member': member.filename,
                    'issue': 'member-read-error',
                    'error': str(error),
                })
                continue
            member_kind = Path(member.filename).suffix.lower() or 'archive-member'
            _item(entries, member_identifier, payload, member_kind, [identifier])
            if Path(member.filename).suffix.lower() == '.ipynb':
                _notebook(entries, issues, member_identifier, payload)


def _load_optional_json(root, relative):
    status = classify_path(root, relative)
    if status in {'missing', 'non-regular'}:
        return None, None
    if status != 'regular' or is_sensitive(relative):
        return None, None
    try:
        data = read_bytes(root, relative)
        return json.loads(data.decode('utf-8')), None
    except (OSError, UnicodeDecodeError, ValueError, TypeError, UnsafePathError) as error:
        return None, str(error)


def _reference_sources(root, paths):
    """Read only safe product text paths used to resolve media references."""
    sources = {}
    source_bytes = {}
    for relative in paths:
        if relative.suffix.lower() not in TEXT or not is_reference_path(relative):
            continue
        if classify_path(root, relative) != 'regular':
            continue
        try:
            data = read_bytes(root, relative)
        except (OSError, UnsafePathError):
            continue
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        identifier = relative.as_posix()
        sources[identifier] = text
        source_bytes[identifier] = data
    return sources, source_bytes


def _external_references(entries, sources, issues):
    external_references = []
    for name, text in sources.items():
        for index, match in enumerate(re.finditer(r"data:((?:image|audio|video)/[^;,\s]+);base64,([A-Za-z0-9+/=\r\n]+)", text)):
            try:
                payload = base64.b64decode(match.group(2), validate=False)
            except (ValueError, binascii.Error):
                issues.append({'path': name, 'issue': 'invalid-media-data-uri', 'index': index})
            else:
                _item(entries, f'{name}#data-uri/{index}/{match.group(1)}', payload, match.group(1), [name])
        for url in sorted(set(re.findall(r'https?://[^\s<>\")]+', text))):
            clean = url.split('?')[0].split('#')[0].rstrip("'")
            if Path(clean).suffix.lower() in MEDIA or re.match(r'https?://(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|bilibili\.com|b23\.tv|v\.youku\.com)/', clean):
                external_references.append({'source': name, 'url': url, 'review_status': 'pending-remote-content-review'})
    return external_references


def build_inventory(root=ROOT, output_path=None):
    """Build an inventory for a Git worktree and optionally write its JSON output."""
    root = Path(root)
    tracked_paths = discover_paths(root, include_untracked=False)
    paths = discover_paths(root)
    media_paths = [relative for relative in paths if relative.suffix.lower() in MEDIA]
    tracked_media_paths = {
        relative for relative in tracked_paths
        if relative.suffix.lower() in MEDIA
    }
    sources, source_bytes = _reference_sources(root, paths)
    entries = []
    issues = []
    safe_media_hashes = {}

    for relative in media_paths:
        identifier = relative.as_posix()
        reason = classify_path(root, relative)
        if reason != 'regular':
            entries.append(_skipped_entry(identifier, reason, _kind_for_path(relative)))
            continue
        try:
            data = read_bytes(root, relative)
        except (OSError, UnsafePathError):
            entries.append(_skipped_entry(identifier, 'unreadable', _kind_for_path(relative)))
            continue
        references = [
            name for name, text in sources.items()
            if name != identifier and relative.name in text
        ]
        entry = _item(entries, identifier, data, relative.suffix.lower(), references)
        safe_media_hashes[identifier] = entry['sha256']
        entry['reference_match'] = 'basename-candidate; resolve before editing'
        if relative.suffix.lower() == '.ipynb':
            _notebook(entries, issues, identifier, data)
        elif relative.suffix.lower() in {'.zip', '.alfredworkflow'}:
            _archive(entries, issues, identifier, data)

    external_references = _external_references(entries, sources, issues)
    source_hashes = {
        name: hashlib.sha256(data).hexdigest()
        for name, data in source_bytes.items()
    }
    source_hashes.update(safe_media_hashes)
    review_issues = []
    ledger, error = _load_optional_json(root, Path('localization/media-reviews.json'))
    if error:
        review_issues = [{'issue': 'review-ledger-parse-error', 'error': error}]
    elif ledger is not None:
        try:
            if not isinstance(ledger, dict):
                raise ValueError('Review ledger must be an object.')
            review_issues = apply_reviews(entries, ledger, source_hashes)
        except (ValueError, TypeError, KeyError) as ledger_error:
            review_issues = [{'issue': 'review-ledger-parse-error', 'error': str(ledger_error)}]

    audio_language_audit_issues = []
    audio_audit, error = _load_optional_json(root, Path('localization/audio-language-audit.json'))
    if error:
        audio_language_audit_issues = [{'issue': 'audio-language-audit-parse-error', 'error': error}]
    elif audio_audit is not None:
        try:
            if not isinstance(audio_audit, dict):
                raise ValueError('Audio language audit must be an object.')
            audio_language_audit_issues = apply_audio_language_audit(entries, audio_audit)
        except (ValueError, TypeError, KeyError) as audit_error:
            audio_language_audit_issues = [{'issue': 'audio-language-audit-parse-error', 'error': str(audit_error)}]

    source_text_audit_issues = []
    source_audit, error = _load_optional_json(root, Path('localization/source-text-audit.json'))
    if error:
        source_text_audit_issues = [{'issue': 'source-text-audit-parse-error', 'error': error}]
    elif source_audit is not None:
        try:
            if not isinstance(source_audit, dict):
                raise ValueError('Source text audit must be an object.')
            source_text_audit_issues = apply_source_text_audit(entries, source_audit)
        except (ValueError, TypeError, KeyError) as audit_error:
            source_text_audit_issues = [{'issue': 'source-text-audit-parse-error', 'error': str(audit_error)}]

    output = {
        'scope': 'All tracked and untracked non-ignored media, font, notebook and archive files; embedded notebook media and archive members included.',
        'limitations': [
            'Inventory is not translation or content validation.',
            'References are basename candidates from product text files, not resolved links.',
            'Localization, docs/superpowers and execution-notes.md are excluded from reference scanning.',
            'Symlinks and sensitive paths are recorded as skipped metadata without reading or hashing content.',
            'Raster images, paths in SVG, speech and video require visual or auditory review.',
            'Notebook code and saved output require separate translation review.',
        ],
        'summary': {
            'entries': len(entries),
            'tracked_paths': len(tracked_paths),
            'tracked_and_unignored_paths': len(paths),
            'tracked_containers_and_assets': len(tracked_media_paths),
            'tracked_and_unignored_containers_and_assets': len(media_paths),
            'by_kind': dict(sorted(Counter(entry['kind'] for entry in entries).items())),
            'pending_content_review': sum(entry.get('review_status') == 'pending-content-review' for entry in entries),
            'reviewed_content': sum(entry.get('review_status', '').startswith('reviewed-') for entry in entries),
            'skipped_paths': sum(entry.get('review_status', '').startswith('skipped-') for entry in entries),
            'review_issues': len(review_issues),
            'audio_language_audit_issues': len(audio_language_audit_issues),
            'source_text_audit_issues': len(source_text_audit_issues),
            'notebook_issues': len(issues),
            'external_media_references': len(external_references),
        },
        'entries': entries,
        'content_review_issues': review_issues,
        'audio_language_audit_issues': audio_language_audit_issues,
        'source_text_audit_issues': source_text_audit_issues,
        'notebook_and_archive_issues': issues,
        'external_media_references': external_references,
    }
    if output_path is not None:
        Path(output_path).write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    return output


def main():
    output = build_inventory(ROOT, ROOT / 'localization/media-inventory.json')
    print(json.dumps(output['summary'], ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
