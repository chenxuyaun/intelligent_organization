import { openDb } from './db.js';
import { createStore } from './store.js';
import { seedIfEmpty } from './seed.js';

// 不删数据库文件（文件可能被运行中的服务占用），而是清空全部行后重新播种。
const TABLES = ['knowledge_uses', 'card_reviews', 'knowledge_cards', 'reviews', 'runs', 'run_groups', 'events', 'tickets', 'members'];
const store = createStore(openDb());
for (const table of TABLES) store.raw.exec(`DELETE FROM ${table}`);
await seedIfEmpty(store);
console.log('演示数据已重置');
