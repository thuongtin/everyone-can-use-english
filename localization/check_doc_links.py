"""Check local links, fragment identifiers and media paths in the built docs."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import sys

ROOT = Path(__file__).resolve().parents[1] / '1000-hours/.vitepress/dist'


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get('id'):
            self.ids.add(attributes['id'])
        for key, value in attrs:
            if value and ((tag == 'a' and key == 'href') or key == 'src' or key.startswith('data-audio-')):
                self.links.append(value)


cache = {}


def page(path):
    path = path.resolve()
    if path not in cache:
        result = Page()
        result.feed(path.read_text())
        cache[path] = result
    return cache[path]


if not (ROOT / 'index.html').is_file():
    sys.exit('Built docs are missing. Run docs:build first.')
broken = []
checked = 0
for path in sorted(ROOT.rglob('*.html')):
    for target in page(path).links:
        url = urlsplit(target)
        if url.scheme or url.netloc:
            continue
        checked += 1
        if url.path.startswith('/'):
            destination = ROOT / unquote(url.path).lstrip('/')
        elif url.path:
            destination = path.parent / unquote(url.path)
        else:
            destination = path
        if destination.is_dir():
            destination /= 'index.html'
        elif not destination.exists() and not destination.suffix:
            destination = destination.with_suffix('.html')
        if not destination.exists():
            issue = 'missing-file'
        elif url.fragment and destination.suffix == '.html' and unquote(url.fragment) not in page(destination).ids:
            issue = 'missing-anchor'
        else:
            continue
        broken.append({'source': str(path.relative_to(ROOT)), 'target': target, 'issue': issue})
print(json.dumps({'checked': checked, 'broken': broken}, ensure_ascii=False, indent=2))
sys.exit(bool(broken))
