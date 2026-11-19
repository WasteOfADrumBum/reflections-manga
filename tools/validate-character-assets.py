"""Validate the character asset manifest and local character-image links.

Run from any directory: python tools/validate-character-assets.py
Uses the Python standard library; does not alter any files.
"""
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import os
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'characters/asset-manifest.json').read_text(encoding='utf-8'))
assets = manifest['assets']
errors = []
paths = [a['path'] for a in assets]
if len(paths) != len(set(paths)):
    errors.append('Duplicate destination paths in manifest')
main_counts = Counter(a['characterId'] for a in assets if a['role'] == 'main')
for char in {a['characterId'] for a in assets}:
    if main_counts[char] != 1:
        errors.append(f'{char}: expected exactly one main reference')
grouped_ids = [char for group in manifest['characterGroups'].values() for char in group['characterIds']]
if len(grouped_ids) != len(set(grouped_ids)) or set(grouped_ids) != set(main_counts):
    errors.append('Cast groups must contain every character exactly once')
for group, details in manifest['characterGroups'].items():
    for char in details['characterIds']:
        expected = f'characters/{group}/{char}'
        if not (ROOT/expected/'index.md').is_file():
            errors.append(f'Missing grouped profile: {expected}')
        if any(a['characterPath'] != expected for a in assets if a['characterId'] == char):
            errors.append(f'Inconsistent character group path: {char}')

for a in assets:
    p = ROOT / a['path']
    if not p.is_file():
        errors.append(f'Missing: {a["path"]}')
        continue
    data = p.read_bytes()
    if hashlib.sha256(data).hexdigest() != a['sha256'] or len(data) != a['size']:
        errors.append(f'Changed image bytes: {a["path"]}')
    if data[:8] != b'\x89PNG\r\n\x1a\n' or list(struct.unpack('>II', data[16:24])) != a['dimensions']:
        errors.append(f'Changed PNG dimensions: {a["path"]}')
    if a['category'] not in [None, *manifest['categories']]:
        errors.append(f'Unsupported category: {a["path"]}')
    if (a['category'] is None) != ('/outfits/_review/' in a['path']):
        errors.append(f'Review classification mismatch: {a["path"]}')
    if a['category'] is None and not a['review']:
        errors.append(f'Missing review note: {a["path"]}')

actual = set()
for char in main_counts:
    character_path = next(a['characterPath'] for a in assets if a['characterId'] == char)
    for directory in ['references', 'outfits']:
        actual.update(p.relative_to(ROOT).as_posix() for p in (ROOT/character_path/directory).rglob('*') if p.is_file() and p.suffix.lower() in ['.png', '.webp', '.jpg', '.jpeg'])
if actual != set(paths):
    errors.append(f'Unmanifested or missing character images: {sorted(actual.symmetric_difference(paths))}')

link_re = re.compile(r'!?\[[^\]\n]*\]\(([^\)\n]+)\)')
broken_other = []
links_checked = 0
retired = {s for a in assets for s in [a['originalPath'], *a['legacyAliases']]}
text_extensions = {'.md', '.txt', '.ts', '.js', '.mjs', '.json', '.yml', '.yaml', '.html', '.css'}
excluded_records = {'characters/asset-manifest.json', 'production/character-asset-organization.md'}
for directory, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '.agents', '.codex', 'private', 'sources', 'test-results', 'playwright-report'}]
    for filename in files:
        p = Path(directory)/filename
        if p.suffix not in text_extensions:
            continue
        rel = p.relative_to(ROOT).as_posix()
        text = p.read_text(encoding='utf-8-sig')
        if rel not in excluded_records:
            for old in retired:
                if old in text:
                    errors.append(f'Stale asset path: {rel} -> {old}')
        if p.suffix != '.md':
            continue
        for match in link_re.finditer(text):
            target = unquote(match[1].split(' "')[0].strip('<>').split('#')[0])
            if not target or re.match(r'^[a-zA-Z][\w+.-]*:', target) or target.startswith('/'):
                continue
            full = (p.parent/target).resolve()
            if full.exists():
                links_checked += 1
                continue
            issue = f'{rel} -> {target}'
            if any(token in full.as_posix() for token in ['/characters/', '/asset-manifest.json']):
                errors.append('Broken character link: ' + issue)
            else:
                broken_other.append(issue)

print(f'{len(assets)} images: hashes, sizes, PNG dimensions, inventory, categories; {len(main_counts)} unique main references.')
print(f'{links_checked} existing local Markdown links checked; {len(broken_other)} unrelated broken local links reported separately.')
if broken_other:
    print('Unrelated broken-link documents: ' + ', '.join(sorted({x.split(' -> ')[0] for x in broken_other})))
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('PASS: no broken character links, lost images, changed artwork, or stale character asset paths.')
