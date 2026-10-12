#!/usr/bin/env python3
"""Build the self-contained Bitaqati HTML from this package's dist directory.

Uses Python's standard library only. It never publishes or reads user records.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    dist = package / 'dist'
    html = (dist / 'index.html').read_text(encoding='utf-8')
    fonts = []
    styles = []
    scripts = []

    def inline_font(match):
        relative = match.group(1)
        path = dist / relative
        payload = base64.b64encode(path.read_bytes()).decode('ascii')
        fonts.append(relative)
        return 'url("data:font/ttf;base64,' + payload + '")'

    def inline_style(match):
        relative = match.group(1)
        css = (dist / relative).read_text(encoding='utf-8')
        css = re.sub(r'url\("(fonts/[^\"]+\.ttf)"\)', inline_font, css)
        if '</style' in css.lower():
            raise ValueError('Unexpected HTML end tag in stylesheet')
        styles.append(relative)
        return '<style data-source="' + relative + '">\n' + css + '\n</style>'

    def inline_script(match):
        relative = match.group(1)
        code = (dist / relative).read_text(encoding='utf-8')
        code = re.sub(r'</script', r'<\\/script', code, flags=re.I)
        scripts.append((relative, code))
        return ''

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_style, html)
    html = re.sub(r'<script src="([^"]+)" defer></script>', inline_script, html)
    if len(styles) != 2 or len(fonts) != 3 or len(scripts) != 8:
        raise ValueError('Source layout changed; review standalone build order')
    if re.search(r'<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"', html, re.I):
        raise ValueError('Runtime dependency was not embedded')
    html = html.replace('href="./" class="brand"', 'href="#" class="brand"')
    embedded = ['<script data-source="' + name + '">\n' + code + '\n</script>' for name, code in scripts]
    embedded.append('''<script data-source="single-file-navigation">
// Return to the same document if the downloaded file has been renamed.
document.querySelector('a.brand').href = location.href.split('#')[0];
</script>''')
    notices = (package / 'THIRD-PARTY-NOTICES.txt').read_text(encoding='utf-8')
    notices = re.sub(r'</script', r'<\\/script', notices, flags=re.I)
    embedded.append('<script type="text/plain" id="third-party-notices">\n' + notices + '\n</script>')
    html = html.replace('</body>', '\n'.join(embedded) + '\n</body>')
    destination = package / 'index.html'
    destination.write_text(html, encoding='utf-8')

    manifest = {str(path.relative_to(package)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(dist.rglob('*')) if path.is_file()}
    (package / 'SOURCE-SHA256.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    output = {'html': str(destination), 'html_bytes': destination.stat().st_size,
              'embedded_scripts': len(scripts), 'embedded_stylesheets': len(styles),
              'embedded_fonts': len(fonts), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        target = args.output_dir.resolve() / 'index.html'
        if target != destination:
            shutil.copyfile(destination, target)
        output['delivery_html'] = str(target)
    if args.archive:
        archive = args.archive.resolve()
        archive.parent.mkdir(parents=True, exist_ok=True)
        allowed = ('dist', 'tests', 'cards', 'index.html', 'README.md', 'اقرأني_أولا.txt',
                   'build-standalone.py', 'THIRD-PARTY-NOTICES.txt', 'SOURCE-SHA256.json')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for name in allowed:
                item = package / name
                paths = sorted(item.rglob('*')) if item.is_dir() else [item]
                for path in paths:
                    if not path.is_file() or path.is_symlink():
                        continue
                    if any(part in ('node_modules', '__pycache__', '.git') for part in path.parts):
                        continue
                    z.write(path, path.relative_to(package.parent))
        with zipfile.ZipFile(archive) as z:
            if z.testzip() is not None:
                raise ValueError('Archive verification failed')
        output['archive'] = str(archive)
        output['archive_bytes'] = archive.stat().st_size
    print(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    main()
