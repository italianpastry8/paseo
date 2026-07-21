import re, sys, os

ALIYUN_KTS = [
    'maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }',
    'maven { url = uri("https://maven.aliyun.com/repository/public") }',
    'maven { url = uri("https://maven.aliyun.com/repository/google") }',
]
ALIYUN_GROOVY = [
    "maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }",
    "maven { url 'https://maven.aliyun.com/repository/public' }",
    "maven { url 'https://maven.aliyun.com/repository/google' }",
]

def fix(path):
    kts = path.endswith('.kts')
    repos = ALIYUN_KTS if kts else ALIYUN_GROOVY
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')
    lines = [l for l in lines if 'maven.aliyun.com' not in l]
    out = []; injected = 0
    for ln in lines:
        m_single = re.match(r'^(\s*)repositories\s*\{(.*)\}\s*$', ln)
        m_multi = re.match(r'^(\s*)repositories\s*\{\s*$', ln)
        if m_single:
            indent = m_single.group(1); inner = m_single.group(2).strip()
            out.append(f'{indent}repositories {{')
            for r in repos: out.append(f'{indent}    {r}')
            if inner: out.append(f'{indent}    {inner}')
            out.append(f'{indent}}}'); injected += 1
        elif m_multi:
            indent = m_multi.group(1)
            out.append(ln)
            for r in repos: out.append(f'{indent}    {r}')
            injected += 1
        else:
            out.append(ln)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    return injected

base = sys.argv[1] if len(sys.argv) > 1 else '.'
total = 0
for rel in sys.stdin:
    rel = rel.strip()
    if not rel: continue
    p = rel if os.path.isabs(rel) else os.path.join(base, rel)
    if os.path.exists(p):
        n = fix(p); total += 1
print(f"=== 共补丁 {total} 个文件 ===")
