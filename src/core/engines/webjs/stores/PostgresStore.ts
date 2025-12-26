import * as fs from 'fs';
import { Pool } from 'pg';

export interface PostgresStoreOptions {
    url?: string;
    pool?: Pool;
}

export class PostgresStore {
    private url: string;
    private pool: Pool;
    private tableName: string = 'waha_sessions';

    constructor({ url, pool }: PostgresStoreOptions) {
        if (!url && !pool) {
            throw new Error("A valid url or pool is required for PostgresStore.");
        }

        if (pool) {
            this.pool = pool;
        } else if (url) {
            this.pool = new Pool({
                connectionString: url,
            });
        }
    }

    private async ensureTable() {
        const query = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id VARCHAR(255) PRIMARY KEY,
                zip BYTEA
            );
        `;
        await this.pool.query(query);
    }

    async sessionExists(options: { session: string }) {
        await this.ensureTable();
        const result = await this.pool.query(
            `SELECT 1 FROM ${this.tableName} WHERE id = $1`,
            [options.session]
        );
        return (result.rowCount ?? 0) > 0;
    }

    async save(options: { session: string }) {
        await this.ensureTable();
        const filename = `${options.session}.zip`;
        const buffer = await fs.promises.readFile(filename);

        await this.pool.query(
            `INSERT INTO ${this.tableName} (id, zip) VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET zip = $2`,
            [options.session, buffer]
        );
    }

    async extract(options: { session: string, path: string }) {
        await this.ensureTable();
        const result = await this.pool.query(
            `SELECT zip FROM ${this.tableName} WHERE id = $1`,
            [options.session]
        );

        if (result.rowCount === 0) {
            throw new Error(`Session ${options.session} not found in store.`);
        }

        const buffer = result.rows[0].zip;
        await fs.promises.writeFile(options.path, buffer);
    }

    async delete(options: { session: string }) {
        await this.ensureTable();
        await this.pool.query(
            `DELETE FROM ${this.tableName} WHERE id = $1`,
            [options.session]
        );
    }
}
