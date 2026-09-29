#!/usr/bin/env python3
"""Explicit local media indexing. Standard-library SQLite; optional host ffprobe.

Source files are opened only for reading. Immutable index generations, a single
writer lock, and an atomic current pointer preserve the previous usable index.
No network, runtime installation, transcription, or image recognition is used.
"""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import uuid
import unicodedata
from contextlib import contextmanager

SCHEMA = 'manuscriptos.media-index/v1'
EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.mts', '.m2ts', '.wmv', '.3gp', '.m4v'}
MAX_DB_BYTES = 128 * 1024 * 1024
FIELDS = ('rel_path', 'name', 'group_dir', 'month_dir', 'size', 'mtime_ns',
          'duration', 'width', 'height', 'vcodec', 'acodec', 'sha256', 'md5',
          'probe_status', 'probe_error', 'processor')


class IndexFailure(Exception):
    pass


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise IndexFailure('invalid_arguments: ' + message)


def require(condition, reason):
    if not condition:
        raise IndexFailure(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def safe_path(value):
    raw = os.fspath(value)
    require(bool(raw) and not re.search(r'[\x00-\x1f]', raw), 'invalid_path')
    if os.name == 'nt':
        require(not re.match(r'^/[a-zA-Z](?:/|:)', raw), 'native_windows_path_required')
    path = Path(os.path.abspath(raw))
    for item in (path, *path.parents):
        require(not item.is_symlink() and not getattr(item, 'is_junction', lambda: False)(), 'linked_path_rejected')
    return path


def disjoint(first, second):
    return first != second and first not in second.parents and second not in first.parents


def read_json(path):
    require(path.stat().st_size <= 1024 * 1024, 'json_over_budget')
    return json.loads(path.read_text(encoding='utf-8'))


def write_new(path, data):
    with open(path, 'xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def owner_for(index, source=None, create=False):
    index = safe_path(index)
    if source is not None:
        source = safe_path(source)
        require(source.is_dir(), 'source_root_unavailable')
        require(disjoint(source, index), 'index_and_source_must_not_overlap')
    if not index.exists():
        require(create and source is not None, 'index_not_found')
        index.parent.mkdir(parents=True, exist_ok=True)
        safe_path(index)
        index.mkdir()  # Exclusive claim; existing unowned directories are rejected.
        owner = {'schemaVersion': SCHEMA, 'sourceRoot': str(source), 'indexId': uuid.uuid4().hex}
        write_new(index / 'owner.json', json_bytes(owner))
        (index / 'generations').mkdir()
        (index / 'exports').mkdir()
    owner = read_json(safe_path(index / 'owner.json'))
    require(owner.get('schemaVersion') == SCHEMA, 'unowned_index_directory')
    bound_source = safe_path(owner['sourceRoot'])
    require(disjoint(bound_source, index), 'index_and_source_must_not_overlap')
    if source is not None:
        require(source == bound_source, 'source_identity_conflict')
    require(safe_path(index / 'generations').is_dir() and safe_path(index / 'exports').is_dir(), 'index_layout_invalid')
    return index, owner


@contextmanager
def writer_lock(index):
    path = safe_path(index / '.build.lock')
    token = json_bytes({'pid': os.getpid(), 'token': uuid.uuid4().hex})
    try:
        write_new(path, token)
    except FileExistsError:
        raise IndexFailure('writer_locked_manual_recovery_required')
    try:
        yield
    finally:
        if path.is_file() and path.read_bytes() == token:
            path.unlink()  # Only this writer's exact lock, never a prior lock.


def current_db(index, owner):
    pointer_path = safe_path(index / 'CURRENT.json')
    if not pointer_path.exists():
        return None, None
    pointer = read_json(pointer_path)
    require(pointer.get('schemaVersion') == SCHEMA and pointer.get('indexId') == owner['indexId'], 'current_identity_invalid')
    generation = pointer.get('generation', '')
    require(re.fullmatch(r'[a-f0-9]{32}\.sqlite3', generation) is not None, 'invalid_generation')
    database = safe_path(index / 'generations' / generation)
    require(database.stat().st_size <= MAX_DB_BYTES, 'database_over_budget')
    require(sha(database.read_bytes()) == pointer['sha256'], 'database_digest_mismatch')
    con = sqlite3.connect(database.as_uri() + '?mode=ro&immutable=1', uri=True)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA query_only=ON')
    require(con.execute('PRAGMA user_version').fetchone()[0] == 1, 'database_schema_invalid')
    return con, pointer


def check_deadline(deadline):
    require(time.monotonic() < deadline, 'time_budget_exhausted')


def scan(source, max_entries, deadline):
    require(source.is_dir(), 'source_root_unavailable')
    rows = {}
    def fail(error):
        raise IndexFailure('scan_incomplete:' + str(error.errno))
    visited = 0
    for directory, dirs, files in os.walk(source, followlinks=False, onerror=fail):
        check_deadline(deadline)
        dirs.sort()
        files.sort()
        for name in dirs + files:
            visited += 1
            require(visited <= max_entries, 'entry_budget_exhausted')
            path = safe_path(Path(directory) / name)
            if name in dirs or path.suffix.lower() not in EXTENSIONS:
                continue
            info = path.stat()
            require(stat.S_ISREG(info.st_mode), 'nonregular_media_file')
            relative = path.relative_to(source).as_posix()
            rows[relative] = (info.st_size, info.st_mtime_ns, info.st_ino, info.st_dev)
    return rows


def parse_probe(returncode, stdout):
    require(returncode == 0, 'ffprobe_nonzero_exit')
    try:
        data = json.loads(stdout)
        streams = data.get('streams', [])
        video = next(s for s in streams if s.get('codec_type') == 'video')
        audio = next((s for s in streams if s.get('codec_type') == 'audio'), {})
        duration = float(data.get('format', {}).get('duration', 0))
        width, height = int(video.get('width', 0)), int(video.get('height', 0))
        require(math.isfinite(duration) and duration > 0 and width > 0 and height > 0 and bool(video.get('codec_name')), 'ffprobe_metadata_incomplete')
        return {'duration': duration, 'width': width, 'height': height,
                'vcodec': video['codec_name'], 'acodec': audio.get('codec_name', ''),
                'probe_status': 'ok', 'probe_error': ''}
    except (ValueError, TypeError, AttributeError, StopIteration):
        raise IndexFailure('ffprobe_invalid_json_or_stream')


def run_bounded(argv, deadline):
    check_deadline(deadline)
    buffers = [bytearray(), bytearray()]
    overflow = threading.Event()
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             shell=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    def drain(stream, buffer, limit):
        try:
            while True:
                block = stream.read(4096)
                if not block:
                    break
                if len(buffer)+len(block) > limit:
                    overflow.set()
                    child.kill()
                    break
                buffer.extend(block)
        finally:
            stream.close()
    threads = [threading.Thread(target=drain,args=(stream,buffer,limit),daemon=True)
               for stream,buffer,limit in zip((child.stdout,child.stderr),buffers,(1024*1024,65536))]
    for worker in threads:
        worker.start()
    try:
        child.wait(timeout=min(30,max(.01,deadline-time.monotonic())))
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
        raise IndexFailure('ffprobe_timeout')
    finally:
        for worker in threads:
            worker.join(timeout=2)
    require(not any(t.is_alive() for t in threads), 'ffprobe_stream_not_closed')
    require(not overflow.is_set(), 'ffprobe_output_over_budget')
    return child.returncode, bytes(buffers[0])


def probe_file(path, executable, deadline):
    try:
        code, output = run_bounded([executable, '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                   '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
                                   '-of', 'json', str(path)], deadline)
        return parse_probe(code, output)
    except OSError:
        raise IndexFailure('ffprobe_unavailable')


def canonical_executable(value):
    found = shutil.which(value)
    require(found is not None, 'ffprobe_unavailable_use_metadata_mode')
    return os.path.normcase(os.path.realpath(found))


def hash_file(path, remaining, deadline):
    h, m, used = hashlib.sha256(), hashlib.md5(), 0
    with open(path, 'rb') as stream:
        while True:
            check_deadline(deadline)
            if used == remaining:
                require(os.fstat(stream.fileno()).st_size == used, 'hash_byte_budget_exhausted')
                break
            block = stream.read(min(1024 * 1024, remaining-used))
            if not block:
                break
            used += len(block)
            require(used <= remaining, 'hash_byte_budget_exhausted')
            h.update(block)
            m.update(block)
    return h.hexdigest(), m.hexdigest(), used


def init_db(con):
    con.execute('PRAGMA user_version=1')
    con.execute('''CREATE TABLE IF NOT EXISTS media(
        rel_path TEXT PRIMARY KEY, name TEXT, group_dir TEXT, month_dir TEXT,
        size INTEGER, mtime_ns INTEGER, duration REAL, width INTEGER, height INTEGER,
        vcodec TEXT, acodec TEXT, sha256 TEXT, md5 TEXT,
        probe_status TEXT, probe_error TEXT, processor TEXT)''')


def stats(con):
    total = dict(con.execute('''SELECT COUNT(*) files, COALESCE(SUM(size),0) bytes,
        COALESCE(SUM(duration),0) durationSeconds, COUNT(duration) durationKnownFiles,
        COALESCE(SUM(probe_status='error'),0) probeErrors, COUNT(sha256) hashedFiles FROM media''').fetchone())
    duplicates = con.execute('''SELECT COUNT(*) groups, COALESCE(SUM(n),0) files,
        COALESCE(SUM(bytes-largest),0) reclaimableBytes FROM
        (SELECT COUNT(*) n,SUM(size) bytes,MAX(size) largest FROM media
         WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*)>1)''').fetchone()
    return {**total, 'GiB': total['bytes']/1024**3, 'GB': total['bytes']/10**9,
            'duplicateCandidates': dict(duplicates),
            'duplicateCoverageComplete': total['hashedFiles'] == total['files'],
            'groups': [dict(r) for r in con.execute('SELECT group_dir,COUNT(*) files,SUM(size) bytes FROM media GROUP BY group_dir ORDER BY group_dir')]}


def build_index(source, index, *, probe=False, hash_content=False, ffprobe=None,
                max_entries=100000, max_hash_bytes=16*1024**3, max_seconds=600):
    require(isinstance(max_entries, int) and 0 < max_entries <= 1000000, 'invalid_entry_budget')
    require(isinstance(max_hash_bytes, int) and max_hash_bytes >= 0, 'invalid_hash_budget')
    require(math.isfinite(max_seconds) and 0 < max_seconds <= 3600, 'invalid_time_budget')
    deadline = time.monotonic()+max_seconds
    source = safe_path(source)
    # Root and complete traversal must succeed even before an index directory is created.
    initial = scan(source, max_entries, deadline)
    executable = canonical_executable(ffprobe or 'ffprobe') if probe else None
    processor = sha(Path(__file__).read_bytes())
    if executable:
        st = Path(executable).stat()
        processor += ':' + sha(json_bytes([executable, st.st_size, st.st_mtime_ns]))
    index, owner = owner_for(index, source, create=True)
    with writer_lock(index):
        old_con, prior = current_db(index, owner)
        old = {r['rel_path']: dict(r) for r in old_con.execute('SELECT * FROM media')} if old_con else {}
        generation = uuid.uuid4().hex+'.sqlite3'
        db_path = safe_path(index / 'generations' / generation)
        write_new(db_path, b'')
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        try:
            if old_con:
                old_con.backup(con)
                old_con.close()
                old_con = None
            init_db(con)
            added = updated = skipped = hashed_bytes = errors = 0
            for relative, before in initial.items():
                check_deadline(deadline)
                previous = old.get(relative)
                same = previous is not None and (previous['size'], previous['mtime_ns']) == before[:2] and previous['processor'] == processor
                if same and (not probe or previous['probe_status'] == 'ok') and (not hash_content or previous['sha256']):
                    skipped += 1
                    continue
                parts = relative.split('/')
                row = dict(previous) if same else dict.fromkeys(FIELDS)
                row.update({'rel_path': relative, 'name': parts[-1], 'group_dir': parts[0] if len(parts)>1 else '',
                            'month_dir': next((p for p in parts if re.fullmatch(r'\d{4}年\d{2}月', p)), ''),
                            'size': before[0], 'mtime_ns': before[1], 'processor': processor})
                row.setdefault('probe_status', 'not_requested')
                if not row['probe_status']:
                    row['probe_status'], row['probe_error'] = 'not_requested', ''
                file = safe_path(source / relative)
                if probe and not (same and previous['probe_status'] == 'ok'):
                    try:
                        row.update(probe_file(file, executable, deadline))
                    except IndexFailure as error:
                        row.update({'duration': None, 'width': None, 'height': None, 'vcodec': None, 'acodec': None,
                                    'probe_status': 'error', 'probe_error': str(error)})
                        errors += 1
                if hash_content and not (same and previous['sha256']):
                    require(before[0] <= max_hash_bytes-hashed_bytes, 'hash_byte_budget_exhausted')
                    row['sha256'], row['md5'], used = hash_file(file, max_hash_bytes-hashed_bytes, deadline)
                    hashed_bytes += used
                info = file.stat()
                require((info.st_size, info.st_mtime_ns, info.st_ino, info.st_dev) == before, 'source_changed_during_processing')
                con.execute('INSERT OR REPLACE INTO media VALUES ('+','.join('?' for _ in FIELDS)+')', tuple(row[k] for k in FIELDS))
                if previous:
                    updated += 1
                else:
                    added += 1
            # A second complete traversal prevents a partial view from deleting old rows.
            require(scan(source, max_entries, deadline) == initial, 'source_changed_during_scan')
            removed = old.keys() - initial.keys()
            con.executemany('DELETE FROM media WHERE rel_path=?', ((r,) for r in removed))
            con.execute('DROP TABLE IF EXISTS media_fts')
            try:
                con.execute("CREATE VIRTUAL TABLE media_fts USING fts5(name,rel_path,month_dir,tokenize='trigram')")
                con.execute('INSERT INTO media_fts(rowid,name,rel_path,month_dir) SELECT rowid,name,rel_path,month_dir FROM media')
                fts = True
            except sqlite3.OperationalError as error:
                if 'no such module' not in str(error) and 'no such tokenizer' not in str(error):
                    raise
                fts = False
            con.commit()
            require(con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'sqlite_integrity_failed')
            totals = stats(con)
            con.close()
            con = None
            require(db_path.stat().st_size <= MAX_DB_BYTES, 'database_over_budget')
            with open(db_path, 'r+b') as stream:
                os.fsync(stream.fileno())
            receipt = {'schemaVersion': SCHEMA, 'indexId': owner['indexId'], 'generation': generation,
                       'sha256': sha(db_path.read_bytes()), 'previousGeneration': prior['generation'] if prior else None,
                       'sourceRoot': str(source), 'createdAt': time.time(), 'ftsAvailable': fts,
                       'added': added, 'updated': updated, 'removed': len(removed), 'skippedProcessing': skipped,
                       'hashBytesRead': hashed_bytes, 'newProbeErrors': errors, 'totals': totals,
                       'ok': totals['probeErrors'] == 0, 'status': 'complete' if totals['probeErrors']==0 else 'partial',
                       'sourceScanComplete': True, 'sourceStability': 'two_metadata_scans_not_atomic_filesystem_snapshot',
                       'sourceWritesPerformed': False, 'contentUnderstandingPerformed': False,
                       'networkUsed': False, 'ftsRebuilt': True}
            write_new(db_path.with_suffix('.receipt.json'), json_bytes(receipt))
            temp = safe_path(index / ('.CURRENT-'+uuid.uuid4().hex+'.tmp'))
            write_new(temp, json_bytes(receipt))
            check_deadline(deadline)
            os.replace(temp, index / 'CURRENT.json')
            require(read_json(index / 'CURRENT.json') == receipt, 'pointer_readback_failed')
            return receipt
        finally:
            if con:
                con.close()
            if old_con:
                old_con.close()


def like_escape(value):
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def search_sql(query='', *, fts=True, group=None, month=None, year=None, codec=None,
               longer=None, shorter=None, min_bytes=None, max_bytes=None, duplicates=False, errors=False):
    require(isinstance(query, str) and len(query) <= 4096, 'invalid_query')
    terms = query.split()
    require(len(terms) <= 32 and all(len(t) <= 200 for t in terms), 'query_over_budget')
    where, params, engines = [], [], []
    for term in terms:
        if fts and len(term) >= 3:
            where.append('m.rowid IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)')
            params.append('"'+term.replace('"', '""')+'"')
            engines.append('trigram')
        else:
            where.append("(m.name LIKE ? ESCAPE '\\' OR m.rel_path LIKE ? ESCAPE '\\' OR m.month_dir LIKE ? ESCAPE '\\')")
            params.extend(['%'+like_escape(term)+'%']*3)
            engines.append('like')
    for name, value, op in [('group_dir', group, 'prefix'), ('month_dir', month, '='), ('vcodec', codec, '=')]:
        if value is not None:
            require(isinstance(value, str) and len(value) <= 200, 'invalid_filter')
            where.append(f"m.{name} LIKE ? ESCAPE '\\'" if op=='prefix' else f'm.{name}=?')
            params.append(like_escape(value)+'%' if op=='prefix' else value)
    if year is not None:
        require(re.fullmatch(r'\d{4}', year) is not None, 'invalid_year')
        where.append('m.month_dir LIKE ?')
        params.append(year+'年%')
    for name, value, op in [('duration', longer, '>'), ('duration', shorter, '<'), ('size', min_bytes, '>='), ('size', max_bytes, '<=')]:
        if value is not None:
            require(isinstance(value, (int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0, 'invalid_numeric_filter')
            where.append(f'm.{name}{op}?')
            params.append(value)
    if duplicates:
        where.append('m.sha256 IN (SELECT sha256 FROM media WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*)>1)')
    if errors:
        where.append("m.probe_status='error'")
    suffix = ' FROM media m'+(' WHERE '+' AND '.join(where) if where else '')
    return suffix, params, {'termEngines': engines, 'combine': 'AND', 'mode': 'keyword_and_filters' if terms else 'filters_only' if where else 'all'}


def csv_safe_cell(value):
    if not isinstance(value, str) or not value:
        return value
    normalized = unicodedata.normalize('NFKC', value)
    if normalized.startswith(('\t', '\r', '\n')) or normalized.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value


def query_index(index, query='', *, limit=100, export=None, **filters):
    require(isinstance(limit, int) and 0 < limit <= 1000, 'invalid_limit')
    index, owner = owner_for(index)
    con, pointer = current_db(index, owner)
    require(con is not None, 'no_published_generation')
    temp = None
    try:
        suffix, params, engine = search_sql(query, fts=pointer['ftsAvailable'], **filters)
        total = con.execute('SELECT COUNT(*)'+suffix, params).fetchone()[0]
        sql = 'SELECT m.*'+suffix+' ORDER BY m.month_dir,m.rel_path'
        if export is not None:
            export_root = safe_path(index / 'exports')
            destination = safe_path(export_root / export)
            require(destination.parent == export_root and destination.suffix.lower()=='.csv', 'export_outside_owned_directory')
            require(not destination.exists(), 'export_already_exists')
            temp = safe_path(export_root / ('.export-'+uuid.uuid4().hex+'.tmp'))
            with open(temp, 'x', encoding='utf-8-sig', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(FIELDS)
                for row in con.execute(sql, params):
                    writer.writerow([csv_safe_cell(value) for value in row])
                stream.flush()
                os.fsync(stream.fileno())
            # Link is an atomic no-replace publication on the same volume.
            os.link(temp, destination)
            return {'ok': True, 'schemaVersion': SCHEMA, 'exportedRows': total, 'path': str(destination),
                    'sha256': sha(destination.read_bytes()), 'sourceWritesPerformed': False, 'query': engine}
        return {'ok': True, 'schemaVersion': SCHEMA, 'total': total, 'returned': min(total,limit),
                'omitted': max(0,total-limit), 'query': engine,
                'rows': [dict(r) for r in con.execute(sql+' LIMIT ?', [*params,limit])],
                'generation': pointer['generation'], 'sourceWritesPerformed': False}
    finally:
        con.close()
        if temp is not None and temp.exists():
            temp.unlink()  # Only this call's private temp; never the destination.


def self_test():
    checks = []
    valid = {'format': {'duration': '2'}, 'streams': [{'codec_type':'video','codec_name':'h264','width':16,'height':16}]}
    checks.append(('valid_probe', parse_probe(0,json.dumps(valid))['duration']==2))
    for label, code, value in [('probe_nonzero',1,'{}'),('probe_missing_stream',0,'{}'),('probe_invalid_json',0,'{')]:
        try:
            parse_probe(code,value)
            checks.append((label,False))
        except IndexFailure:
            checks.append((label,True))
    con = sqlite3.connect(':memory:')
    con.row_factory = sqlite3.Row
    init_db(con)
    con.execute("CREATE VIRTUAL TABLE media_fts USING fts5(name,rel_path,month_dir,tokenize='trigram')")
    for i in range(3):
        con.execute('INSERT INTO media(rel_path,name,size,sha256,probe_status) VALUES (?,?,?,?,?)', (f'{i}.mp4','2026年微信家庭视频.mp4',100,'same','ok'))
    con.execute('INSERT INTO media_fts(rowid,name,rel_path,month_dir) SELECT rowid,name,rel_path,month_dir FROM media')
    for label, q, expected in [('mixed_short_filters','2026 北京',0),('two_short_terms','微信 视频',3),('trigram_literal','微信家庭',3)]:
        suffix, params, _ = search_sql(q)
        checks.append((label,con.execute('SELECT COUNT(*)'+suffix,params).fetchone()[0]==expected))
    checks.append(('duplicate_bytes',stats(con)['duplicateCandidates']['reclaimableBytes']==200))
    con.close()
    return {'ok':all(passed for _,passed in checks),'schemaVersion':SCHEMA,'passed':sum(p for _,p in checks),'total':len(checks),
            'cases':[{'id':name,'passed':passed} for name,passed in checks],
            'scope':'in_memory_contract_smoke_only', 'mediaRead':False,'hostValidated':False}


def main():
    if '--describe' in sys.argv[1:] and len(sys.argv)==2:
        return {'ok':True,'schemaVersion':SCHEMA,'commands':['build','search','stats','export'],
                'build':'--source-root <source> --index-root <new-owned-index> [--probe] [--hash]',
                'search':'--index-root <index> [words...] [filters]','export':'--index-root <index> --output <new-name.csv> [words...] [filters]',
                'defaults':{'probe':False,'hash':False,'maxHashBytes':16*1024**3,'maxSeconds':600},
                'sourceReadOnly':True,'optionalParser':'host ffprobe','dependencies':'Python standard library; no external Skill',
                'exitCodes':{'success':0,'partial_or_blocked':2},'contentUnderstandingPerformed':False}
    if '--self-test' in sys.argv[1:] and len(sys.argv)==2:
        return self_test()
    parser = JsonArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    build = sub.add_parser('build')
    build.add_argument('--source-root',required=True)
    build.add_argument('--index-root',required=True)
    build.add_argument('--probe',action='store_true')
    build.add_argument('--hash',dest='hash_content',action='store_true')
    build.add_argument('--ffprobe')
    build.add_argument('--max-entries',type=int,default=100000)
    build.add_argument('--max-hash-bytes',type=int,default=16*1024**3)
    build.add_argument('--max-seconds',type=float,default=600)
    for name in ('search','export','stats'):
        command = sub.add_parser(name)
        command.add_argument('--index-root',required=True)
        if name=='stats':
            continue
        command.add_argument('query',nargs='*')
        for flag in ('group','month','year','codec'):
            command.add_argument('--'+flag)
        for flag in ('longer','shorter'):
            command.add_argument('--'+flag,type=float)
        for flag in ('min-bytes','max-bytes'):
            command.add_argument('--'+flag,type=int)
        command.add_argument('--duplicates',action='store_true')
        command.add_argument('--errors',action='store_true')
        command.add_argument('--limit',type=int,default=100)
        if name=='export':
            command.add_argument('--output',required=True)
    args = vars(parser.parse_args())
    name, index = args.pop('command'), args.pop('index_root')
    if name=='build':
        return build_index(args.pop('source_root'),index,**args)
    if name=='stats':
        index, owner = owner_for(index)
        con, pointer = current_db(index,owner)
        require(con is not None,'no_published_generation')
        try:
            return {'ok':True,'schemaVersion':SCHEMA,'generation':pointer['generation'],'totals':stats(con),'sourceWritesPerformed':False}
        finally:
            con.close()
    return query_index(index,' '.join(args.pop('query')),export=args.pop('output',None),**args)


if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        result = main()
    except (IndexFailure,OSError,ValueError,KeyError,sqlite3.Error) as error:
        result = {'ok':False,'schemaVersion':SCHEMA,'status':'blocked','error':str(error),
                  'publishedState':'check_current_pointer_and_generation_receipts','sourceWritesPerformed':False}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(0 if result['ok'] else 2)
