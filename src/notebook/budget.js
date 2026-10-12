import { parseAmount } from '../lib/utils.js';
import { readPageFields } from './fieldStore.js';

export const BUDGET_ITEM_FROM = 470;
export const BUDGET_ITEM_TO = 483;

export function sumBudget(read = readPageFields) {
    const rows = [];
    for (let page = BUDGET_ITEM_FROM; page <= BUDGET_ITEM_TO; page += 1) {
        const fields = read(page) || {};
        const budget = parseAmount(fields.budget);
        const used = parseAmount(fields.used);
        rows.push({
            page,
            slot: page - 469,
            name: String(fields.name || '').trim() || `사업 ${page - 469}`,
            budget,
            used,
            left: budget - used,
        });
    }
    const budget = rows.reduce((sum, row) => sum + row.budget, 0);
    const used = rows.reduce((sum, row) => sum + row.used, 0);
    return { rows, budget, used, left: budget - used };
}
