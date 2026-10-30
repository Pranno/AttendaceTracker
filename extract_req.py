import zipfile, re
z = zipfile.ZipFile('/workspace/Attendance_Tracker_Requirements.docx')
xml = z.read('word/document.xml').decode('utf-8', 'ignore')
paras = re.split(r'</w:p>', xml)
out = []
for p in paras:
    texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S)
    line = ''.join(texts)
    m = re.search(r'w:val="(Heading\d|Title)"', p)
    if m:
        line = '[' + m.group(1) + '] ' + line
    if line.strip():
        out.append(line)
print('\n'.join(out))
