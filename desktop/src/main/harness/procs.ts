import { execFile, spawn } from 'node:child_process'

// Finding the process behind one tool call. Harnesses run each shell command
// as a child process whose command line carries the command text, so we can
// pick it out of the harness's process tree and end just that branch. The
// harness sees a failed command and carries on.

type Proc = { pid: number; ppid: number; cmd: string }

function list(): Promise<Proc[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
        ],
        { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000 },
        (err, out) => {
          if (err) return resolve([])
          try {
            const rows = JSON.parse(out) as { ProcessId: number; ParentProcessId: number; CommandLine: string | null }[]
            resolve(rows.map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, cmd: r.CommandLine ?? '' })))
          } catch {
            resolve([])
          }
        },
      )
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,command='], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([])
        resolve(
          out
            .split('\n')
            .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
            .filter((m): m is RegExpMatchArray => !!m)
            .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] })),
        )
      })
    }
  })
}

export function killTree(pid: number) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  else
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
}

/**
 * Kill the process running `command` somewhere under `root`. Returns false if
 * nothing under the harness matches (the command already finished, or the
 * tool doesn't run a process).
 */
export async function killCommand(root: number, command: string): Promise<boolean> {
  const procs = await list()
  const kids = new Map<number, Proc[]>()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])

  // every process under the harness, with its depth
  const under: (Proc & { depth: number })[] = []
  const walk = (pid: number, depth: number) => {
    for (const k of kids.get(pid) ?? []) {
      under.push({ ...k, depth })
      walk(k.pid, depth + 1)
    }
  }
  walk(root, 1)
  if (!under.length) return false

  // score by distinctive words of the command found in each command line
  const words = [...new Set(command.match(/[A-Za-z0-9_][\w.\-]{2,}/g) ?? [])]
  const score = (p: Proc) => words.filter((w) => p.cmd.includes(w)).length
  const best = Math.max(...under.map(score))
  const need = Math.min(words.length, 2)

  let target: (Proc & { depth: number }) | undefined
  if (words.length && best >= need)
    // the highest process in the tree that matches: killing it takes its children too
    target = under.filter((p) => score(p) === best).sort((a, b) => a.depth - b.depth)[0]
  else {
    // no text to match on: fall back to a lone shell directly under the harness
    const shells = under.filter((p) => p.depth === 1 && /(bash|sh|zsh|pwsh|powershell|cmd)(\.exe)?["\s]/i.test(p.cmd + ' '))
    if (shells.length === 1) target = shells[0]
  }
  if (!target) return false
  killTree(target.pid)
  return true
}
