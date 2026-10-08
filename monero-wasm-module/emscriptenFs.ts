export type EmscriptenFsStat = {
  mode: number;
  size?: number;
};

export type EmscriptenFs = {
  readdir(path: string): string[];
  stat(path: string): EmscriptenFsStat;
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
  rename(oldPath: string, newPath: string): void;
};
