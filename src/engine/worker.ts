/** Web Worker entry: runs simulations off the UI thread. */
import { expose } from 'comlink';
import { workerApi } from './worker-api';

expose(workerApi);
