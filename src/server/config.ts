import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = process.env.BINDER_DATA_DIR
  ? path.resolve(process.env.BINDER_DATA_DIR)
  : path.join(ROOT_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'binder.db')
export const BACKUP_DIR = path.join(DATA_DIR, 'backups')
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'dist', 'web')
export const HOST = '127.0.0.1'
export const PORT = Number(process.env.PORT ?? 4321)
/** The OCR helper's Swift source and the binary built from it (spec §5.1.4). */
export const OCR_SOURCE = path.join(ROOT_DIR, 'native', 'ocr.swift')
export const OCR_BINARY = path.join(ROOT_DIR, 'bin', 'ocr')
/** Where `pnpm ocr:bench` keeps the card images it downloads (spec §5.1.6). */
export const BENCH_DIR = path.join(DATA_DIR, 'bench')
/** Holds ANTHROPIC_API_KEY, written by the Settings page (spec §3.1). */
export const ENV_PATH = path.join(ROOT_DIR, '.env')
/** Captured card photos waiting in the scan queue (spec §5.1.2). */
export const SCANS_DIR = path.join(DATA_DIR, 'scans')
