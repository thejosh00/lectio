/**
 * Loaded before every test file. Nothing a test runs may reach the real `~/.lectio`,
 * so the default data directory points somewhere disposable before any code reads it.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env['LECTIO_DIR'] = mkdtempSync(join(tmpdir(), 'lectio-test-'));
delete process.env['LECTIO_TOKEN'];
delete process.env['LECTIO_URL'];
// Days are local. Not-UTC is what proves it.
process.env['TZ'] = 'America/Chicago';
