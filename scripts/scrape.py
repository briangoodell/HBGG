"""
Download recent GeoGrid boards into data/ so the app has demo grids.

    python scripts/scrape.py          # last 7 days
    python scripts/scrape.py 30       # last 30 days

GeoGrid serves its boards as static JSON from a CDN, so this is just a
few GETs. Each board is rewritten into our own minimal format (below),
which is the same format a future grid generator should emit:

    {
      "id":      "928",
      "title":   "GeoGrid #928 · 2026-10-21",
      "rows":    ["Member of the Arab League", ...],   # 3 labels
      "cols":    ["Has a desert", ...],                # 3 labels
      "answers": [[...country names...], ...],         # 9 cells, row-major
      "rarity":  [{"Egypt": 12.3, ...}, ...]           # optional: % of players
    }                                                  # who chose each answer

Rarity comes from GeoGrid's API, which doesn't allow browser requests
from other sites, so we snapshot it here. Today's board keeps changing
during the day, so re-run the script later to refresh it.
"""

import json
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

CDN   = 'https://cdn-assets.teuteuf.fr/data/'
API   = 'https://api.geogridgame.com/api/'
EPOCH = date(2024, 4, 7)   # date of GeoGrid board #1
DATA  = Path(__file__).resolve().parent.parent / 'data'


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def percentages(counts):
    total = counts.pop('total') or 1
    return {name: round(100 * n / total, 1) for name, n in counts.items()}


def convert_board(raw, rarity, day):
    return {
        'id':      raw['grid_id'],
        'title':   f"GeoGrid #{raw['grid_id']} · {day.isoformat()}",
        'rows':    [r['name'] for r in raw['rows']],
        'cols':    [c['name'] for c in raw['columns']],
        'answers': [raw['answers'][f'match_box_{i}'] for i in range(1, 10)],
        'rarity':  [percentages(rarity[f'match_box_{i}']) for i in range(1, 10)],
    }


def main(days=7):
    (DATA / 'boards').mkdir(parents=True, exist_ok=True)

    countries = [{'code': c['code'], 'name': c['name']} for c in fetch_json(CDN + 'common/countries.json')]
    countries.sort(key=lambda c: c['name'])
    (DATA / 'countries.json').write_text(json.dumps(countries, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'countries: {len(countries)}')

    index = []
    for back in range(days):
        day = date.today() - timedelta(days=back)
        board_id = (day - EPOCH).days + 1
        try:
            raw    = fetch_json(f'{CDN}geogrid/boards/{board_id}.json')
            rarity = fetch_json(f'{API}game/rarity/{board_id}')
            board  = convert_board(raw, rarity, day)
        except Exception as e:
            print(f'board {board_id}: skipped ({e})')
            continue
        path = DATA / 'boards' / f'{board_id}.json'
        path.write_text(json.dumps(board, ensure_ascii=False), encoding='utf-8')
        index.append({'id': board['id'], 'title': board['title']})
        print(f'board {board_id}: ok')

    (DATA / 'boards' / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
