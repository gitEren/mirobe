import { createApp, startVideoPoller, sweepStaleJobs } from './app';
import { loadConfig } from './config';
import { openDb } from './db/index';
import { createApnsSender } from './lib/apns';
import { MediaStorage } from './lib/storage';
import { UsageLedger } from './lib/usage';
import { pruneNotices } from './lib/userNotices';

const config = loadConfig();
const db = openDb(config.dataDir);
const push = createApnsSender(config);
const ctx = { db, config, media: new MediaStorage(db, config.dataDir), usage: new UsageLedger(db), push };

// Jobs a previous process left 'processing' (crash, restart mid-call) are failed and refunded,
// and in-app notices past their 30 days are deleted.
const sweep = () => {
  sweepStaleJobs(ctx);
  pruneNotices(db);
};
sweep();
setInterval(sweep, 5 * 60 * 1000).unref();
startVideoPoller(ctx);
createApp(ctx).listen(config.port, '0.0.0.0', () => {
  console.log(`Mirobe API on :${config.port} (data: ${config.dataDir})`);
  console.log(
    `providers → openrouter: ${config.openRouterKey ? 'on' : 'off'}, fal: ${config.falKey ? 'on' : 'off'}, revenuecat: ${config.revenueCatSecret ? 'on' : 'off'}, apns: ${push ? 'on' : 'off'}${config.devPlanOverride ? `, dev plan: ${config.devPlanOverride}` : ''}`
  );
});
