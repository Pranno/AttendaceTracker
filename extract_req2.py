import zipfile, re
z = zipfile.ZipFile('/workspace/Attendance_Tracker_Requirements.docx')
xml = z.read('word/document.xml').decode('utf-8', 'ignore')

# Remove table property/grid markup noise but keep cell text separated by |
xml = xml.replace('<w:tblPr>', '\n[TBLPR]').replace('<w:tblGrid>', '\n[GRID]')
xml = re.sub(r'<w:tcPr>.*?</w:tcPr>', '', xml, flags=re.S)
xml = re.sub(r'<w:trPr>.*?</w:trPr>', '', xml, flags=re.S)
xml = xml.replace('<w:tr>', '\n[ROW] ').replace('</w:tr>', '')
xml = xml.replace('<w:tc>', ' | ').replace('</w:tc>', '')

paras = re.split(r'</w:p>', xml)
out = []
for p in paras:
    texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S)
    line = ''.join(texts)
    m = re.search(r'w:val="(Heading\d|Title)"', p)
    if m:
        line = '\n[' + m.group(1) + '] ' + line
    if line.strip():
        out.append(line)
text = '\n'.join(out)
import html
print(html.unescape(text))
