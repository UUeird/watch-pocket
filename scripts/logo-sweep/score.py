"""Scores each candidate's confidence and merges the logo and logomark sweeps into the review page's data.

Usage: python3 score.py <repo> review/candidates.json marks.json review
Reads the logo review data (already with thumbnails), adds the logomark sweep's brands with their current logo as
a candidate to crop from, scores everything, and writes review/candidates.json plus marks-pending.json (candidates
still needing a thumbnail).
"""
import json, re, shutil, sys, unicodedata
from pathlib import Path

repo, logo_path, marks_path, review = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])

def words(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return [w for w in re.split(r'[^a-z0-9]+', s) if len(w) > 1]

PHOTO = re.compile(r'\b(dsc|img|photo|photograph|photography|watch|dial|store|shop|boutique|sign|building|le mans|automatic)\b', re.I)
OLD = re.compile(r'\b(old|former|historic|vintage|1[89]\d\d|19[0-9]0s)\b', re.I)

def score(brand, c):
    """A confidence (high, medium, low) and a one-line reason for one candidate."""
    wd = brand.get('wikidata') or {}
    how = wd.get('how')
    title = c['title'].removeprefix('File:')
    stem = re.sub(r'\.\w+$', '', title)
    reasons, level = [], 2  # 3 high, 2 medium, 1 low
    if c['via'] in ('Wikidata logo', 'Wikidata icon'):
        prop = 'small logo or icon' if c['via'] == 'Wikidata icon' else 'logo'
        if how in ('source', 'wikipedia source'):
            level = 3
            reasons.append(f"Wikidata's {prop} for {wd.get('label') or wd['qid']}, the item this brand's own sources cite")
        else:
            level = 2
            reasons.append(f"Wikidata's {prop} for {wd.get('label') or wd['qid']}, matched to this brand by name ({wd.get('description') or 'no description'})")
    elif c['via'] == 'Current logo':
        level = 3
        reasons.append('The logo already on the site, to crop a logomark from')
    else:
        extra = [w for w in words(stem) if w not in words(brand['name'])]
        exact = all(w in ('logo', 'logotype', 'wordmark', 'svg', 'png') for w in extra)
        if how:
            level = 3 if exact else 2
            reasons.append(f"Commons file named for the brand{'' if exact else ' with extra words'}; brand matched on Wikidata")
        else:
            level = 1 if len(words(brand['name'])) == 1 else 2
            reasons.append('Only the file name ties it to this brand' + (', and the name is a common word' if level == 1 else ''))
    if PHOTO.search(stem) and not re.search(r'logo', stem, re.I):
        level = 1
        reasons.append('looks like a photograph, not a logo file')
    elif OLD.search(stem):
        level = min(level, 2)
        reasons.append('may be an older version')
    if c.get('mime') == 'image/svg+xml':
        reasons.append('vector (SVG)')
    elif c.get('mime') == 'image/jpeg':
        reasons.append('JPEG, so no transparent background')
    return ['low', 'medium', 'high'][level - 1], '; '.join(reasons)

# Run again on its own output, it starts from the logo brands alone.
import time, urllib.request
UA = {'User-Agent': 'watch-pocket logo sweep/1.0 (sam@samelawrence.com)'}
EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg'}

def fetch_thumb(c, n):
    """Saves the 320px rendering Commons named for this file, or the original, as thumbs/m<n>; its path or None."""
    for url in filter(None, [c.get('thumb'), c.get('url')]):
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
                    ext = EXT.get(res.headers.get_content_type(), 'png')
                    path = f'thumbs/m{n:03d}.{ext}'
                    (review / path).write_bytes(res.read())
                    time.sleep(0.15)
                    return path
            except urllib.error.HTTPError as e:
                if e.code in (400, 404): break
                time.sleep(1.5 * (attempt + 1))
            except Exception:
                time.sleep(1.5 * (attempt + 1))
    return None

logo_brands = [b for b in json.loads(logo_path.read_text()) if b.get('kind') != 'mark']
for b in logo_brands:
    b['kind'] = 'logo'

marks = json.loads(marks_path.read_text())
thumbs = review / 'thumbs'
pending = []
mark_brands = []
for b in marks:
    yaml = (repo / 'src/data/brands' / f"{b['id']}.yaml").read_text()
    m = re.search(r'^logo: \.\./logos/(\S+)', yaml, re.M)
    candidates = []
    if m:
        src = repo / 'src/data/logos' / m.group(1)
        dest = thumbs / f"current-{m.group(1)}"
        shutil.copyfile(src, dest)
        licence = re.search(r'^  license: (.+)$', yaml, re.M)
        source = re.search(r'^  source: (\S+)', yaml, re.M)
        candidates.append({
            'title': f"Current logo ({m.group(1)})",
            'page': source.group(1) if source else '',
            'licence': licence.group(1) if licence else 'Unknown',
            'via': 'Current logo',
            'mime': 'image/svg+xml' if src.suffix == '.svg' else f"image/{src.suffix[1:].replace('jpg', 'jpeg')}",
            'width': 0, 'height': 0,
            'thumbPath': f"thumbs/{dest.name}",
            'current': True,
        })
    for c in b['candidates']:
        thumb = fetch_thumb(c, len(pending))
        if thumb:
            c['thumbPath'] = thumb
            pending.append(c)
            candidates.append(c)
    b['candidates'] = candidates
    b['kind'] = 'mark'
    b['certain'] = True
    mark_brands.append(b)

for b in logo_brands + mark_brands:
    for c in b['candidates']:
        c['confidence'], c['why'] = score(b, c)
    order = {'high': 0, 'medium': 1, 'low': 2}
    b['candidates'].sort(key=lambda c: (not c.get('current'), order[c['confidence']]))

mark_brands.sort(key=lambda b: b['name'].lower())
(review / 'candidates.json').write_text(json.dumps(logo_brands + mark_brands))
from collections import Counter
print(len(logo_brands), 'logo brands,', len(mark_brands), 'logomark brands,', len(pending), 'thumbnails fetched')
print(Counter(c['confidence'] for b in logo_brands + mark_brands for c in b['candidates']))
