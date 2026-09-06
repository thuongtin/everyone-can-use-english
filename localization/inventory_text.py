"""Inventory source text without treating a character scan as translation QA."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'localization/text-inventory.json'
HAN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff]')
TEXT_EXTENSIONS = {
    '.md', '.mdx', '.txt', '.rst', '.html', '.htm', '.vue', '.tsx', '.ts',
    '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc',
    '.yml', '.yaml', '.toml', '.xml', '.css', '.scss', '.sass', '.less',
    '.py', '.go', '.sh', '.zsh', '.sql', '.csv', '.srt', '.vtt',
    '.applescript', '.metal', '.lock',
}
TEXT_NAMES = {'README', 'LICENSE', 'Dockerfile', 'Makefile'}
MEDIA_EXTENSIONS = {
    '.mp3', '.mp4', '.wav', '.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp',
    '.pdf', '.ico', '.icns', '.ttf', '.woff', '.woff2', '.zip', '.ipynb',
    '.alfredworkflow',
}
SENSITIVE_NAMES = {
    '.npmrc', '.pypirc', '.netrc', 'credentials.json', 'auth.json',
    'secrets.json', 'service-account.json',
}
SENSITIVE_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.keystore'}
MAX_BYTES = 10_000_000


def is_sensitive(path):
    return any(
        part.lower() == '.env' or part.lower().startswith('.env.')
        or part.lower() in SENSITIVE_NAMES
        for part in path.parts
    ) or path.suffix.lower() in SENSITIVE_SUFFIXES


paths = sorted(set(filter(None, subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd=ROOT,
).decode().split('\0'))))
entries = []
for name in paths:
    relative = Path(name)
    path = ROOT / relative
    entry = {'path': name, 'han_in_path': bool(HAN.search(name))}
    if is_sensitive(relative):
        entry['scan_status'] = 'skipped-sensitive'
    elif name in {'localization/text-inventory.json', 'localization/media-inventory.json'}:
        entry['scan_status'] = 'excluded-generated-inventory'
    elif relative.suffix.lower() in MEDIA_EXTENSIONS:
        entry['scan_status'] = 'covered-by-media-inventory'
    elif relative.suffix and relative.suffix.lower() not in TEXT_EXTENSIONS and relative.name not in TEXT_NAMES:
        entry['scan_status'] = 'unclassified-file-type'
    elif path.is_symlink():
        entry['scan_status'] = 'skipped-symlink'
    elif not path.is_file():
        entry['scan_status'] = 'missing-worktree-file'
    elif path.stat().st_size > MAX_BYTES:
        entry['scan_status'] = 'skipped-large-file'
    else:
        data = path.read_bytes()
        try:
            content = data.decode('utf-8')
        except UnicodeDecodeError:
            entry['scan_status'] = 'not-utf8-text'
        else:
            entry.update({
                'scan_status': 'scanned',
                'bytes': len(data),
                'sha256': hashlib.sha256(data).hexdigest(),
                'han_count': len(HAN.findall(content)),
                'han_lines': [index for index, line in enumerate(content.splitlines(), 1) if HAN.search(line)],
                'review_status': 'requires-context-review',
            })
    entries.append(entry)

summary = {
    'files_listed': len(entries),
    'scan_status_counts': dict(Counter(item['scan_status'] for item in entries)),
    'files_with_han': sum(item.get('han_count', 0) > 0 for item in entries),
    'han_total': sum(item.get('han_count', 0) for item in entries),
}
OUTPUT.write_text(json.dumps({
    'scope': 'Tracked and unignored source files in the current worktree.',
    'limits': 'Counts cover CJK Unified Ideographs and Extension A, including identifiers, quotations and language resources. They do not cover every Han Unicode range. A zero count is not proof of complete translation. Media, archives, notebooks and unclassified file types require separate review.',
    'summary': summary,
    'entries': entries,
}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, indent=2))
