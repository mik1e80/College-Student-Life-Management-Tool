// Short, original PCM chime used only when the device has no readable default tone.
import {mkdirSync,writeFileSync} from 'node:fs';
const rate=22050,seconds=1.2,count=Math.round(rate*seconds),data=Buffer.alloc(count*2),header=Buffer.alloc(44);
for(let i=0;i<count;i++) {const t=i/rate,p=t%.6,envelope=p<.35?Math.min(1,p/.02,(.35-p)/.04):0;const v=(Math.sin(2*Math.PI*660*t)+.35*Math.sin(2*Math.PI*990*t))*.22*envelope;data.writeInt16LE(Math.round(v*32767),i*2);}
header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
mkdirSync('android/app/src/main/res/raw',{recursive:true});writeFileSync('android/app/src/main/res/raw/alarm_fallback.wav',Buffer.concat([header,data]));
