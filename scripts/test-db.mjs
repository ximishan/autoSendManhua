import { openDatabase as openRealDatabase } from '../src/db/index.js';
import { SUPPORTED_PLATFORMS } from '../src/core/task.js';

// Test fixtures supply explicit valid accounts just as the UI must. Production validation is untouched.
export function openDatabase(file=':memory:') {
  const db=openRealDatabase(file);
  for(const platform of SUPPORTED_PLATFORMS)db.accounts.upsert({id:'test_'+platform,platform,profilePath:'unused-test-profile-'+platform});
  const create=db.tasks.create.bind(db.tasks);
  db.tasks.create=(input,options)=>create({...input,accountIds:{
    ...Object.fromEntries(['weibo',...(input.selectedPlatforms||[])].map(p=>[p,'test_'+p])),...input.accountIds
  }},options);
  return db;
}
