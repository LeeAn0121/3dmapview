import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const run=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options}).trim();
const remote=run('git',['remote','get-url','origin']);
const match=remote.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
if(!match)throw new Error('origin이 GitHub 저장소여야 합니다.');
const [,owner,repo]=match;
const base=repo.toLowerCase()===`${owner.toLowerCase()}.github.io`?'/':`/${repo}/`;
execFileSync('npm',['run','build'],{stdio:'inherit',env:{...process.env,VITE_BASE_PATH:base}});
await fs.writeFile('dist/.nojekyll','');
const staging=await fs.mkdtemp(path.join(os.tmpdir(),'floor-atlas-pages-'));
try{
  run('git',['init','--initial-branch=gh-pages',staging]);
  const git=args=>run('git',args,{cwd:staging});
  git(['remote','add','origin',remote]);
  if(git(['ls-remote','--heads','origin','gh-pages'])){
    git(['fetch','--depth=1','origin','gh-pages']);git(['reset','--mixed','FETCH_HEAD']);
  }
  await fs.cp('dist',staging,{recursive:true});
  git(['add','--all']);
  try{git(['-c',`user.name=${owner}`,'-c',`user.email=${owner}@users.noreply.github.com`,'commit','-m','Deploy Floor Atlas to GitHub Pages']);}
  catch(error){if(!git(['status','--porcelain']))console.log('빌드 변경 사항이 없습니다.');else throw error;}
  git(['push','origin','HEAD:gh-pages']);
  console.log(`Published gh-pages: https://${owner.toLowerCase()}.github.io${base}`);
}finally{await fs.rm(staging,{recursive:true,force:true});}
