# Reproduce the source using FFmpeg with libx265 (no customer image):
# ffmpeg -f lavfi -i testsrc2=size=64x48:rate=1 -frames:v 1 -c:v libx265 \
#   -x265-params pools=1:frame-threads=1:log-level=error -tag:v hvc1 synthetic-photo.mp4
# python3 tests/fixtures/make-photo-1140-heic.py synthetic-photo.mp4
from pathlib import Path
import sys
import struct,base64,hashlib
raw=Path(sys.argv[1]).read_bytes()
box=lambda kind,data:struct.pack('>I',8+len(data))+kind.encode()+data
full=lambda kind,version,data:box(kind,struct.pack('>I',version<<24)+data)
u16=lambda n:struct.pack('>H',n)
u32=lambda n:struct.pack('>I',n)
def boxes(data):
 pos=0
 while pos<len(data):
  n=struct.unpack('>I',data[pos:pos+4])[0];assert n>=8 and pos+n<=len(data)
  yield data[pos+4:pos+8],data[pos+8:pos+n];pos+=n
mdat=next(data for kind,data in boxes(raw) if kind==b'mdat')
pos=0;sample=b''
while pos<len(mdat):
 n=struct.unpack('>I',mdat[pos:pos+4])[0];nal=mdat[pos+4:pos+4+n];assert len(nal)==n
 if (nal[0]>>1)&63 < 32:sample+=u32(n)+nal
 pos+=4+n
assert sample
hvcc=raw.index(b'hvcC');n=struct.unpack('>I',raw[hvcc-4:hvcc])[0];hvcc=raw[hvcc+4:hvcc-4+n]
ftyp=box('ftyp',b'heic'+u32(0)+b'mif1heic')
def meta(offset):
 hdlr=full('hdlr',0,u32(0)+b'pict'+bytes(12)+b'JessieMessage synthetic colour bars\0')
 pitm=full('pitm',0,u16(1))
 iloc=full('iloc',0,b'\x44\x00'+u16(1)+u16(1)+u16(0)+u16(1)+u32(offset)+u32(len(sample)))
 infe=full('infe',2,u16(1)+u16(0)+b'hvc1'+b'synthetic-bars\0')
 iinf=full('iinf',0,u16(1)+infe)
 ipco=box('ipco',box('hvcC',hvcc)+full('ispe',0,u32(64)+u32(48))+full('pixi',0,b'\x03\x08\x08\x08'))
 ipma=full('ipma',0,u32(1)+u16(1)+b'\x03\x81\x82\x83')
 return full('meta',0,hdlr+pitm+iloc+iinf+box('iprp',ipco+ipma))
m=meta(0);m=meta(len(ftyp)+len(m)+8)
data=ftyp+m+box('mdat',sample)
p=Path(__file__).resolve().parent
(p/'photo-1140.heic.b64').write_text(base64.b64encode(data).decode()+'\n')
print(len(data),hashlib.sha256(data).hexdigest())
