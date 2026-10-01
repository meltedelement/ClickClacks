// A Web Worker for the finder page: plays one chunk of the search per message.
import { runTask } from './search.js';

self.onmessage = (e) => self.postMessage(runTask(e.data));
