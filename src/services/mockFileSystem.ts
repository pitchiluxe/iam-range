/**
 * services/mockFileSystem.ts — the workstation's disk.
 *
 * The shell used to answer `dir` from a fixed array and `cd` by string
 * surgery, so `mkdir` was impossible, `cd Windows\System32` failed, and File
 * Explorer showed a different set of folders from the one the terminal listed.
 * Two views of a disk that disagreed, which is the failure this project keeps
 * removing everywhere else.
 *
 * One tree now, shared by both. It is genuinely mutable: create a folder in
 * the terminal and Explorer shows it, delete it in Explorer and the terminal
 * stops finding it.
 *
 * Deliberately not the real disk. Nothing here touches the host machine —
 * reading the learner's actual files would be wrong for a lab and a privacy
 * problem — so this is an in-memory tree seeded to look like a domain-joined
 * Windows workstation.
 */
import { VM_HOST } from '@/config/vmHost';
import { PRODUCT } from '@/config/product';

export type NodeKind = 'dir' | 'file';

export interface FsNode {
  name: string;
  kind: NodeKind;
  /** File contents. Directories have none. */
  content?: string;
  /** Children, by lowercased name. Files have none. */
  children?: Map<string, FsNode>;
  modified: number;
  /** System folders refuse deletion, as they do on a real machine. */
  readonly?: boolean;
}

export type FsResult = { ok: true; message?: string } | { ok: false; error: string };

const DRIVE = 'C:';

function dir(name: string, readonly = false): FsNode {
  return { name, kind: 'dir', children: new Map(), modified: Date.now(), readonly };
}

function file(name: string, content = ''): FsNode {
  return { name, kind: 'file', content, modified: Date.now() };
}

export class MockFileSystem {
  private root: FsNode = dir(DRIVE, true);
  /** Where the shell currently is. Explorer navigates independently. */
  private cwd = `${DRIVE}\\Users\\${VM_HOST.user}`;

  constructor() {
    this.seed();
  }

  // --- Path handling --------------------------------------------------------

  /**
   * Turn anything the user typed into an absolute path.
   *
   * Handles `C:\x`, `\x`, `x`, `.`, `..` and trailing slashes, because all of
   * those are things people type and a shell that only accepts one of them is
   * a shell people stop using.
   */
  resolvePath(input: string, from = this.cwd): string {
    const raw = input.trim().replace(/\//g, '\\');
    let base: string[];

    if (/^[a-z]:\\?/i.test(raw)) {
      base = [];
    } else if (raw.startsWith('\\')) {
      base = [];
    } else {
      base = from.replace(/^[a-z]:\\?/i, '').split('\\').filter(Boolean);
    }

    const parts = raw.replace(/^[a-z]:/i, '').split('\\').filter(Boolean);
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    return base.length === 0 ? `${DRIVE}\\` : `${DRIVE}\\${base.join('\\')}`;
  }

  private segments(path: string): string[] {
    return path.replace(/^[a-z]:\\?/i, '').split('\\').filter(Boolean);
  }

  /** The node at a path, or undefined. */
  node(path: string): FsNode | undefined {
    let current: FsNode | undefined = this.root;
    for (const part of this.segments(path)) {
      if (!current?.children) return undefined;
      current = current.children.get(part.toLowerCase());
    }
    return current;
  }

  private parentOf(path: string): { parent: FsNode | undefined; name: string } {
    const parts = this.segments(path);
    const name = parts.pop() ?? '';
    const parentPath = parts.length === 0 ? `${DRIVE}\\` : `${DRIVE}\\${parts.join('\\')}`;
    return { parent: this.node(parentPath), name };
  }

  exists(path: string): boolean {
    return this.node(path) !== undefined;
  }

  // --- Reading --------------------------------------------------------------

  getCwd(): string {
    return this.cwd;
  }

  /** Change directory. Refuses a file or a path that is not there. */
  setCwd(input: string): FsResult {
    const path = this.resolvePath(input);
    const node = this.node(path);
    if (!node) {
      return { ok: false, error: `Cannot find path '${input}' because it does not exist.` };
    }
    if (node.kind !== 'dir') return { ok: false, error: `'${input}' is not a directory.` };
    this.cwd = path;
    return { ok: true };
  }

  /** Directory contents, directories first then files, both alphabetical. */
  list(path = this.cwd): FsNode[] | null {
    const node = this.node(this.resolvePath(path));
    if (!node || node.kind !== 'dir' || !node.children) return null;
    return Array.from(node.children.values()).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  readFile(path: string): string | null {
    const node = this.node(this.resolvePath(path));
    return node && node.kind === 'file' ? (node.content ?? '') : null;
  }

  // --- Writing --------------------------------------------------------------

  makeDir(input: string): FsResult {
    const path = this.resolvePath(input);
    if (this.exists(path)) return { ok: false, error: `'${input}' already exists.` };

    const { parent, name } = this.parentOf(path);
    if (!parent || parent.kind !== 'dir' || !parent.children) {
      return { ok: false, error: `Cannot find the parent directory for '${input}'.` };
    }
    parent.children.set(name.toLowerCase(), dir(name));
    parent.modified = Date.now();
    return { ok: true, message: `Created ${path}` };
  }

  writeFile(input: string, content: string): FsResult {
    const path = this.resolvePath(input);
    const existing = this.node(path);
    if (existing && existing.kind === 'dir') {
      return { ok: false, error: `'${input}' is a directory.` };
    }
    const { parent, name } = this.parentOf(path);
    if (!parent || parent.kind !== 'dir' || !parent.children) {
      return { ok: false, error: `Cannot find the parent directory for '${input}'.` };
    }
    if (existing) {
      existing.content = content;
      existing.modified = Date.now();
    } else {
      parent.children.set(name.toLowerCase(), file(name, content));
      parent.modified = Date.now();
    }
    return { ok: true, message: `Wrote ${path}` };
  }

  /**
   * Delete a file or directory.
   *
   * A non-empty directory needs `recurse`, because `rm` quietly taking a whole
   * tree with it is how people lose work — the refusal is the safety.
   */
  remove(input: string, recurse = false): FsResult {
    const path = this.resolvePath(input);
    const node = this.node(path);
    if (!node) return { ok: false, error: `Cannot find '${input}'.` };
    if (node.readonly) return { ok: false, error: `'${node.name}' is protected and cannot be removed.` };
    if (node.kind === 'dir' && node.children && node.children.size > 0 && !recurse) {
      return {
        ok: false,
        error: `'${node.name}' is not empty. Use -Recurse to delete it and everything in it.`,
      };
    }
    const { parent, name } = this.parentOf(path);
    if (!parent?.children) return { ok: false, error: `Cannot find the parent of '${input}'.` };
    parent.children.delete(name.toLowerCase());
    parent.modified = Date.now();
    return { ok: true, message: `Removed ${path}` };
  }

  move(fromInput: string, toInput: string): FsResult {
    const fromPath = this.resolvePath(fromInput);
    const node = this.node(fromPath);
    if (!node) return { ok: false, error: `Cannot find '${fromInput}'.` };
    if (node.readonly) return { ok: false, error: `'${node.name}' is protected and cannot be moved.` };

    const toPath = this.resolvePath(toInput);
    // Moving into an existing directory keeps the name, as every shell does.
    const target = this.node(toPath);
    const destPath = target?.kind === 'dir' ? `${toPath}\\${node.name}` : toPath;
    if (this.exists(destPath)) return { ok: false, error: `'${destPath}' already exists.` };

    const dest = this.parentOf(destPath);
    if (!dest.parent?.children) {
      return { ok: false, error: `Cannot find the destination directory for '${toInput}'.` };
    }
    const src = this.parentOf(fromPath);
    src.parent?.children?.delete(src.name.toLowerCase());
    node.name = dest.name;
    dest.parent.children.set(dest.name.toLowerCase(), node);
    return { ok: true, message: `Moved to ${destPath}` };
  }

  copy(fromInput: string, toInput: string): FsResult {
    const node = this.node(this.resolvePath(fromInput));
    if (!node) return { ok: false, error: `Cannot find '${fromInput}'.` };

    const toPath = this.resolvePath(toInput);
    const target = this.node(toPath);
    const destPath = target?.kind === 'dir' ? `${toPath}\\${node.name}` : toPath;
    if (this.exists(destPath)) return { ok: false, error: `'${destPath}' already exists.` };

    const dest = this.parentOf(destPath);
    if (!dest.parent?.children) {
      return { ok: false, error: `Cannot find the destination directory for '${toInput}'.` };
    }
    dest.parent.children.set(dest.name.toLowerCase(), clone(node, dest.name));
    return { ok: true, message: `Copied to ${destPath}` };
  }

  // --- Seed -----------------------------------------------------------------

  private seed(): void {
    const mk = (path: string, readonly = false): FsNode => {
      const parts = this.segments(path);
      let current = this.root;
      for (const part of parts) {
        const key = part.toLowerCase();
        let next = current.children?.get(key);
        if (!next) {
          next = dir(part, readonly);
          current.children?.set(key, next);
        }
        current = next;
      }
      return current;
    };

    // The folders a domain-joined workstation has, marked protected so a
    // learner cannot delete the system out from under themselves.
    mk('Windows', true);
    mk('Windows\\System32', true);
    mk('Program Files', true);
    // The application's own install folder, so Explorer and the Control Panel
    // agree about where it lives.
    mk(`Program Files\\${PRODUCT.installFolder}`, true);
    mk('Program Files (x86)', true);
    mk('Users', true);

    const home = mk(`Users\\${VM_HOST.user}`);
    home.readonly = true;
    for (const folder of ['Desktop', 'Documents', 'Downloads', 'Scripts']) mk(`Users\\${VM_HOST.user}\\${folder}`);

    // A couple of files, so `type` has something to show and the learner can
    // see that files and folders are different things here.
    this.writeFile(
      `${DRIVE}\\Users\\${VM_HOST.user}\\Documents\\readme.txt`,
      [
        'This is the workstation disk.',
        '',
        'It is a simulation, not your real machine — nothing here reads or',
        'writes anything on the computer running the lab.',
        '',
        'Try: dir, cd Scripts, mkdir reports, echo "note" > note.txt, type note.txt',
      ].join('\n'),
    );
    this.writeFile(
      `${DRIVE}\\Users\\${VM_HOST.user}\\Scripts\\onboard.ps1`,
      [
        '# Bulk onboarding, one account per line.',
        '$names = @("jdoe", "mchen", "rpatel")',
        'foreach ($n in $names) {',
        '  New-ADUser -SamAccountName $n -Name $n',
        '}',
      ].join('\n'),
    );
  }

  reset(): void {
    this.root = dir(DRIVE, true);
    this.cwd = `${DRIVE}\\Users\\${VM_HOST.user}`;
    this.seed();
  }
}

/** Deep copy, so a copied folder is not the same folder under two names. */
function clone(node: FsNode, name: string): FsNode {
  if (node.kind === 'file') return { ...node, name, modified: Date.now() };
  const copy: FsNode = { name, kind: 'dir', children: new Map(), modified: Date.now() };
  for (const [key, child] of node.children ?? []) {
    copy.children?.set(key, clone(child, child.name));
  }
  return copy;
}
