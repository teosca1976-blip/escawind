import { runAll } from './lib.mjs';
export default async () => { await runAll({ notify: true }); };
// UTC: 07:30/13:30/19:30 ora solare, 08:30/14:30/20:30 ora legale
export const config = { schedule: '30 6,12,18 * * *' };
