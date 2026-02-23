import "dotenv/config";
import { describe, test, expect } from "@jest/globals";
import { getBlockfrostFetcher } from "@app/cardano/standalone";
import { CIP68_PREFIX } from "@app/config/config.service";

// --- Sửa policyId tại đây (56 ký tự hex) ---
const POLICY_ID = "df7339e888a9b8d33302f6eda9e4cfb02fb37057cee7b25a64fd6276";

const PREFIX_REF100 = CIP68_PREFIX.REFERENCE_100; // 000643b0
const PREFIX_222 = CIP68_PREFIX.USER_222; // 000de140

function hexToUtf8(hex: string): string {
    try {
        return Buffer.from(hex, "hex").toString("utf8");
    } catch {
        return hex;
    }
}

/**
 * Từ unit (policyId + prefix + hexName) lấy asset name dạng string.
 * unit = policyId (56) + prefix (8) + hex(displayName)
 */
function assetNameFromUnit(policyId: string, unit: string): { prefix: string; name: string } | null {
    if (!unit.startsWith(policyId) || unit.length <= policyId.length + 8) return null;
    const afterPolicy = unit.slice(policyId.length);
    const prefix = afterPolicy.slice(0, 8);
    const hexName = afterPolicy.slice(8);
    if (!hexName) return { prefix, name: "" };
    return { prefix, name: hexToUtf8(hexName) };
}

export type PolicyAssetRow = {
    assetName: string;
    ref100Unit: string | null;
    ref100Quantity: string;
    nft222Unit: string | null;
    nft222Quantity: string;
};

/**
 * Nhập policy ID, trả về danh sách asset name + ref100 (và NFT 222) thuộc policy.
 */
async function listAssetsByPolicy(policyId: string): Promise<PolicyAssetRow[]> {
    const fetcher = getBlockfrostFetcher();
    const raw = await fetcher.fetchAssetsByPolicy(policyId);
    const byLogicalName = new Map<string, { ref100?: { unit: string; quantity: string }; nft222?: { unit: string; quantity: string } }>();

    for (const { asset: unit, quantity } of raw) {
        if (!unit.startsWith(policyId)) continue;
        const parsed = assetNameFromUnit(policyId, unit);
        if (!parsed) continue;
        const { prefix, name } = parsed;
        if (prefix === PREFIX_REF100) {
            let row = byLogicalName.get(name);
            if (!row) {
                row = {};
                byLogicalName.set(name, row);
            }
            row.ref100 = { unit, quantity };
        } else if (prefix === PREFIX_222) {
            let row = byLogicalName.get(name);
            if (!row) {
                row = {};
                byLogicalName.set(name, row);
            }
            row.nft222 = { unit, quantity };
        }
    }

    const rows: PolicyAssetRow[] = [];
    for (const [assetName, row] of byLogicalName.entries()) {
        rows.push({
            assetName,
            ref100Unit: row.ref100?.unit ?? null,
            ref100Quantity: row.ref100?.quantity ?? "0",
            nft222Unit: row.nft222?.unit ?? null,
            nft222Quantity: row.nft222?.quantity ?? "0",
        });
    }
    rows.sort((a, b) => a.assetName.localeCompare(b.assetName));
    return rows;
}

describe("Trace – list assets by policy", function () {
    test("Nhập policy ID → trả về hết assetName và Ref100 (và NFT 222)", async function () {
        const rows = await listAssetsByPolicy(POLICY_ID);
        console.log("\n=== Policy:", POLICY_ID);
        console.log("Tổng số asset name (logical):", rows.length);
        console.log("");
        for (const r of rows) {
            console.log("Asset name:", r.assetName);
            console.log("  Ref100:", r.ref100Unit ?? "—", "qty:", r.ref100Quantity);
            console.log("  NFT222:", r.nft222Unit ?? "—", "qty:", r.nft222Quantity);
            console.log("");
        }
        expect(Array.isArray(rows)).toBe(true);
    });
});
