import { readFileSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';

// How many worker threads the headless tools (balance, sweep, flawless) run
// by default: one per physical core. A match gains next to nothing from a
// core's second hardware thread, and two workers sharing a core slow each
// other down: on a 6-core, 12-thread laptop, 6 workers got through a sweep
// about 10% sooner than 11. Linux says which logical CPUs share a core;
// elsewhere this is every logical CPU but one, as before.
export function defaultJobs() {
  return physicalCores() ?? Math.max(1, availableParallelism() - 1);
}

// Physical cores this process can use, or null if the system doesn't say.
function physicalCores() {
  const dir = '/sys/devices/system/cpu';
  try {
    const cores = new Set();
    for (const name of readdirSync(dir)) {
      if (!/^cpu\d+$/.test(name)) continue;
      const topology = `${dir}/${name}/topology`;
      // Each logical CPU lists the ones on its core (the older name is thread_siblings_list).
      const siblings = readFirst([`${topology}/core_cpus_list`, `${topology}/thread_siblings_list`]);
      if (siblings) cores.add(siblings);
    }
    // A process limited to fewer CPUs (affinity, a container) can't use the rest.
    return cores.size > 0 ? Math.max(1, Math.min(cores.size, availableParallelism())) : null;
  } catch {
    return null;
  }
}

function readFirst(files) {
  for (const file of files) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      // Not there (an offline CPU, an older kernel): try the next.
    }
  }
  return null;
}
