# -*- coding: utf-8 -*-
"""Pick up bookq/*.json ({"isbn": "..."} or {"q": "书名"}), look the book up on
douban, and write data/books/<key>.json so the workbench page can read it.

Run by .github/workflows/booklookup.yml on GitHub runners (unrestricted network).
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
REF = 'https://book.douban.com/'
OUT = 'data/books'
QUEUE = 'bookq'

INFO_KEYS = ['作者', '译者', '编者', '出版社', '出版时间', '出版年', 'ISBN',
             '页数', '装帧', '定价', '原作名', '副标题', '丛书', '出品方', '统一书号']


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Referer': REF,
        'Accept-Language': 'zh-CN,zh;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=timeout) as f:
        return f.read().decode('utf-8', 'replace')


def strip_tags(s):
    s = re.sub(r'<script[\s\S]*?</script>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'\s+', ' ', s)


def split_info(text):
    text = re.sub(r'\s+', ' ', text or '')
    pat = re.compile('(' + '|'.join(INFO_KEYS) + r')\s*[:：]')
    marks = [(m.group(1), m.start(), m.end()) for m in pat.finditer(text)]
    out = {}
    for i, (k, s, e) in enumerate(marks):
        stop = marks[i + 1][1] if i + 1 < len(marks) else len(text)
        v = text[e:stop].strip()
        if v and k not in out:
            out[k] = v
    return out


def parse_page(html):
    title = ''
    m = re.search(r'<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)</span>', html)
    if m:
        title = strip_tags(m.group(1)).strip()
    if not title:
        m = re.search(r'<title>([\s\S]*?)</title>', html)
        if m:
            title = strip_tags(m.group(1)).split('(')[0].strip(' -·')

    cover = ''
    m = re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html)
    if m:
        cover = m.group(1)
    if not cover:
        m = re.search(r'id="mainpic"[\s\S]{0,300}?<img[^>]*src="([^"]+)"', html)
        if m:
            cover = m.group(1)
    # 统一要中等尺寸，省流量
    cover = cover.replace('/view/subject/l/', '/view/subject/m/').replace('/view/subject/s/', '/view/subject/m/')

    info = {}
    mi = re.search(r'<div id="info"[\s\S]*?</div>', html)
    if mi:
        info = split_info(strip_tags(mi.group(0)))

    intro = ''
    m = re.search(r'<div[^>]*class="intro"[^>]*>([\s\S]*?)</div>', html)
    if m:
        intro = strip_tags(m.group(1)).strip()[:600]

    return {
        'title': title,
        'author': (info.get('作者') or '').replace(' ', ''),
        'translator': info.get('译者') or '',
        'publisher': info.get('出版社') or '',
        'year': (info.get('出版时间') or info.get('出版年') or '')[:4],
        'pages': int(re.sub(r'\D', '', info.get('页数') or '0') or 0),
        'isbn': re.sub(r'[^\dXx]', '', info.get('ISBN') or ''),
        'price': info.get('定价') or '',
        'binding': info.get('装帧') or '',
        'series': info.get('丛书') or '',
        'cover': cover,
        'intro': intro,
    }


def lookup_isbn(isbn):
    isbn = re.sub(r'[^\dXx]', '', isbn or '')
    if len(isbn) < 10:
        return None, 'isbn too short'
    try:
        html = get('https://book.douban.com/isbn/%s/' % isbn)
    except Exception as e:
        return None, 'fetch: %s' % e
    md = parse_page(html)
    if not md.get('title'):
        return None, 'no title parsed'
    md['isbn'] = md.get('isbn') or isbn
    md['from'] = 'relay'
    md['at'] = int(time.time())
    return md, None


def lookup_query(q):
    """书名搜索：返回豆瓣 suggest 的第一条，再抓详情补齐。"""
    try:
        raw = get('https://book.douban.com/j/subject_suggest?q=' + urllib.parse.quote(q))
        arr = json.loads(raw)
    except Exception as e:
        return None, 'suggest: %s' % e
    if not arr:
        return None, 'no result'
    first = arr[0]
    url = first.get('url') or ''
    if url:
        try:
            md = parse_page(get(url))
            if md.get('title'):
                md['from'] = 'relay'
                md['at'] = int(time.time())
                return md, None
        except Exception:
            pass
    return {
        'title': first.get('title') or '',
        'author': first.get('author_name') or '',
        'translator': '', 'publisher': '', 'year': str(first.get('year') or ''),
        'pages': 0, 'isbn': '', 'price': '', 'binding': '', 'series': '',
        'cover': first.get('pic') or '', 'intro': '',
        'url': url, 'from': 'relay', 'at': int(time.time()),
    }, None


def main():
    if not os.path.isdir(QUEUE):
        print('no queue dir')
        return
    os.makedirs(OUT, exist_ok=True)
    files = sorted(f for f in os.listdir(QUEUE) if f.endswith('.json'))
    print('queue:', files)
    for name in files:
        path = os.path.join(QUEUE, name)
        try:
            job = json.load(open(path, encoding='utf-8'))
        except Exception as e:
            print('bad job', name, e)
            os.remove(path)
            continue
        isbn = job.get('isbn') or ''
        q = job.get('q') or ''
        key = re.sub(r'[^\w\-]', '_', (isbn or q))[:60]
        if not key:
            os.remove(path)
            continue
        if isbn:
            md, err = lookup_isbn(isbn)
            if not md and q:
                md, err = lookup_query(q)
        else:
            md, err = lookup_query(q)
        if md:
            dest = os.path.join(OUT, key + '.json')
            json.dump(md, open(dest, 'w', encoding='utf-8'), ensure_ascii=False)
            print('OK', key, md.get('title'), '| cover:', bool(md.get('cover')))
        else:
            print('FAIL', key, err)
            json.dump({'error': err, 'at': int(time.time())},
                      open(os.path.join(OUT, key + '.json'), 'w', encoding='utf-8'),
                      ensure_ascii=False)
        os.remove(path)
        time.sleep(2)


if __name__ == '__main__':
    main()
