#!/usr/bin/env python
"""
Scontorna le foto profilo degli atleti (rimozione sfondo, tutto in locale con rembg: nessuna foto esce dal PC)
e le carica nello storage Supabase come atletas/cutout/<id>.png, registrando il campo `photo_cutout` in entity_overrides.
La foto originale non viene mai toccata: la scheda atleta usa la versione scontornata se c'e', altrimenti l'originale.

Uso:
  python photo-cutout.py --env C:/.../italiacrit/server/.env.local [--limit 100] [--only-cx] [--ids A,B] [--dry-run] [--revert]

  --limit N     al massimo N foto in questo giro (default 100)
  --only-cx     solo atleti presenti nei risultati ciclocross della stagione in corso (data/ciclocross/*/results.json)
  --ids A,B     solo questi atleta_id
  --dry-run     scarica e scontorna ma non carica ne' scrive nel database (salva i PNG in --out)
  --revert      cancella tutti i campi photo_cutout dal database (le foto originali restano)
"""
import argparse, hashlib, io, json, os, random, re, sys, time, urllib.parse, urllib.request

BASE = 'https://aqqsstsbgpapzoxllosh.supabase.co'
PUB = BASE + '/storage/v1/object/public'


def load_env(path):
    for line in open(path, encoding='utf-8'):
        m = re.match(r'^([^#=\s]+)\s*=\s*(.*)$', line.strip())
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip().strip('"\'')


def req(method, url, key, data=None, headers=None, timeout=60):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'User-Agent': 'ics-cutout/1.0'}
    h.update(headers or {})
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read()


def rest_get(path, key):
    return json.loads(req('GET', BASE + '/rest/v1/' + path, key).decode('utf-8'))


def fetch_all(field, key):
    out, off = {}, 0
    while True:
        rows = rest_get('entity_overrides?entity_type=eq.atleta&field=eq.%s&select=entity_id,new_value&order=id&limit=1000&offset=%d' % (field, off), key)
        for r in rows:
            if r.get('new_value'):
                out[r['entity_id']] = r['new_value']
        if len(rows) < 1000:
            break
        off += 1000
    return out


def safe_name(aid):
    s = re.sub(r'[^A-Za-z0-9_-]', '_', aid)
    return s if s == aid else s + '_' + hashlib.sha1(aid.encode('utf-8')).hexdigest()[:6]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--env', required=True)
    ap.add_argument('--limit', type=int, default=100)
    ap.add_argument('--only-cx', action='store_true')
    ap.add_argument('--ids', default='')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--revert', action='store_true')
    ap.add_argument('--out', default='')
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    load_env(a.env)
    key = os.environ.get('SUPABASE_SECRET')
    if not key:
        print('SUPABASE_SECRET mancante'); sys.exit(1)

    if a.revert:
        req('DELETE', BASE + '/rest/v1/entity_overrides?entity_type=eq.atleta&field=eq.photo_cutout', key)
        print('rimossi tutti i photo_cutout (le foto originali non sono state toccate)')
        return

    from PIL import Image
    from rembg import remove, new_session

    photos = fetch_all('photo_url', key)
    done = fetch_all('photo_cutout', key)
    print('foto atleti: %d, gia scontornate: %d' % (len(photos), len(done)))

    ids = [i for i in photos if i not in done]
    if a.ids:
        want = set(x for x in a.ids.split(',') if x)
        ids = [i for i in photos if i in want]
    if a.only_cx:
        here = os.path.dirname(os.path.abspath(__file__))
        cx = set()
        root = os.path.join(here, '..', 'data', 'ciclocross')
        for d in os.listdir(root):
            p = os.path.join(root, d, 'results.json')
            if os.path.isfile(p):
                for r in json.load(open(p, encoding='utf-8')):
                    if r.get('atleta_id'):
                        cx.add(r['atleta_id'])
        ids = [i for i in ids if i in cx]
    random.Random(a.seed).shuffle(ids)
    ids = ids[:a.limit]
    print('da elaborare in questo giro: %d' % len(ids))

    out_dir = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'cutout-out')
    os.makedirs(out_dir, exist_ok=True)
    sess = new_session('u2net_human_seg')
    stats = {'ok': 0, 'gia_trasparente': 0, 'dubbia': 0, 'errore': 0}
    t0 = time.time()
    for n, aid in enumerate(ids, 1):
        path = photos[aid].split('?')[0]
        try:
            orig = urllib.request.urlopen(urllib.request.Request(PUB + path, headers={'User-Agent': 'ics-cutout/1.0'}), timeout=40).read()
            im = Image.open(io.BytesIO(orig))
            # gia scontornata (PNG con molto trasparente): si usa cosi com'e'
            if im.mode in ('RGBA', 'LA', 'P'):
                al = im.convert('RGBA').getchannel('A')
                hist = al.histogram()
                transp = sum(hist[:20]) / float(im.width * im.height)
                if transp >= 0.08:
                    if not a.dry_run:
                        body = json.dumps([{'entity_type': 'atleta', 'entity_id': aid, 'field': 'photo_cutout', 'new_value': path, 'edited_by': None}]).encode()
                        req('POST', BASE + '/rest/v1/entity_overrides?on_conflict=entity_type,entity_id,field', key, body,
                            {'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'})
                    stats['gia_trasparente'] += 1
                    print('[%d/%d] %s gia trasparente (%.0f%%)' % (n, len(ids), aid, transp * 100))
                    continue
            res = remove(orig, session=sess, post_process_mask=True)
            cut = Image.open(io.BytesIO(res)).convert('RGBA')
            hist = cut.getchannel('A').histogram()
            transp = sum(hist[:20]) / float(cut.width * cut.height)
            if transp < 0.10 or transp > 0.85:
                stats['dubbia'] += 1
                print('[%d/%d] %s DUBBIA (trasparente %.0f%%): non caricata' % (n, len(ids), aid, transp * 100))
                cut.save(os.path.join(out_dir, 'dubbia_' + safe_name(aid) + '.png'))
                continue
            buf = io.BytesIO(); cut.save(buf, 'PNG', optimize=True); png = buf.getvalue()
            name = safe_name(aid)
            cut.save(os.path.join(out_dir, name + '.png'))
            if not a.dry_run:
                sp = 'atletas/cutout/%s.png' % name
                req('POST', BASE + '/storage/v1/object/photos/' + sp, key, png, {'Content-Type': 'image/png', 'x-upsert': 'true'})
                url = '/photos/%s?v=%s' % (sp, hashlib.sha1(png).hexdigest()[:8])
                body = json.dumps([{'entity_type': 'atleta', 'entity_id': aid, 'field': 'photo_cutout', 'new_value': url, 'edited_by': None}]).encode()
                req('POST', BASE + '/rest/v1/entity_overrides?on_conflict=entity_type,entity_id,field', key, body,
                    {'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'})
            stats['ok'] += 1
            print('[%d/%d] %s ok (trasparente %.0f%%, %d KB)' % (n, len(ids), aid, transp * 100, len(png) // 1024))
        except Exception as e:
            stats['errore'] += 1
            print('[%d/%d] %s ERRORE: %s' % (n, len(ids), aid, str(e)[:120]))
    print('FINE %s in %.0fs' % (json.dumps(stats), time.time() - t0))


if __name__ == '__main__':
    main()
