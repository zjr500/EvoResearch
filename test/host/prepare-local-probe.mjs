// Creates only new synthetic fixtures in an explicit, empty validation directory.
import {mkdirSync,writeFileSync,copyFileSync,constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2];
if(!root||!isAbsolute(root))throw new Error('Supply an absolute, new validation directory');
mkdirSync(root);mkdirSync(join(root,'workspace'));mkdirSync(join(root,'heldout'));
for(const [name,value] of [['train','SYNTHETIC_TRAIN'],['validation','SYNTHETIC_VALIDATION']])writeFileSync(join(root,'workspace',name+'.txt'),value,{flag:'wx'});
writeFileSync(join(root,'heldout','test.txt'),'SYNTHETIC_TEST_ONLY',{flag:'wx'});
writeFileSync(join(root,'heldout','test.lock'),'evaluation-only',{flag:'wx'});
for(const name of ['stream','access'])copyFileSync(fileURLToPath(new URL('../fixtures/local-'+name+'.py',import.meta.url)),join(root,'workspace',name+'.py'),constants.COPYFILE_EXCL);
const project=fileURLToPath(new URL('../../',import.meta.url));
const quoted=p=>JSON.stringify(resolve(project,p).replaceAll('\\','/'));
writeFileSync(join(root,'probe.patch.yml'),'- insert:\n    - id: evoresearch\n      name: '+quoted('dist/index.js')+'\n    - id: batch3-probe\n      name: '+quoted('test/host/local-probe.mjs')+'\n',{flag:'wx'});
console.log('Synthetic probe fixtures prepared');
