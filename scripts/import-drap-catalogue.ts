
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../server/prisma.js";

const execFileAsync = promisify(execFile);
const BASE_URL = "https://eapp.dra.gov.pk";
const DESCRIPTION_MAX_LENGTH = 500;

const args = process.argv.slice(2);

const searchTerms = args
  .filter((arg) => arg.startsWith("--search="))
  .map((arg) => arg.slice("--search=".length).trim())
  .filter(Boolean);

const SEARCH_TERMS = searchTerms.length
  ? searchTerms
  : [
      "paracetamol",
      "ibuprofen",
      "amoxicillin",
      "azithromycin",
      "metformin",
      "omeprazole",
      "cetirizine",
      "ciprofloxacin",
      "diclofenac",
      "atorvastatin",
    ];

const APPLY_CHANGES = args.includes("--apply");
const UPDATE_EXISTING = args.includes("--update-existing");
const registrationFilter = args
  .filter((arg) => arg.startsWith("--registration="))
  .map((arg) => arg.slice("--registration=".length).trim())
  .filter(Boolean);

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function curlRequest(curlArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--connect-timeout",
      "20",
      "--max-time",
      "60",
      ...curlArgs,
    ],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return stdout;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(?:39|039);/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function clean(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:div|p|li)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DRAP sometimes returns malformed markup such as:
 * <spanclass="fw-semibold">Human</span>
 *
 * This parser accepts both normal and malformed span openings.
 */
function field(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const labelRegex = new RegExp(
    `<span\\b[^>]*>\\s*${escaped}\\s*<\\/span>`,
    "i",
  );

  const match = labelRegex.exec(html);

  if (!match) return "";

  const remaining = html.slice(match.index + match[0].length);

  const valueMatch = remaining.match(
    /^\s*<(span(?:\s|class)[^>]*)>([\s\S]*?)<\/span\s*>/i,
  );

  return clean(valueMatch?.[2] ?? "");
}

function isPlaceholder(value: string): boolean {
  return /^(?:test\d*|unknown|n\/a|na|none|null|-|not available)$/i.test(
    value.trim(),
  );
}

function normalizeUnit(value: string): string {
  return value
    .replace(/\bmcg\b/gi, "mcg")
    .replace(/\bμg\b/gi, "mcg")
    .replace(/\bµg\b/gi, "mcg")
    .replace(/\bmg\b/gi, "mg")
    .replace(/\bg\b/gi, "g")
    .replace(/\bml\b/gi, "ml")
    .replace(/\biu\b/gi, "IU")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

type CompositionResult = {
  genericName: string;
  strength: string;
  parsed: boolean;
};

/**
 * Conservative composition parser.
 *
 * Examples:
 * PARACETAMOL 500 mg
 * -> PARACETAMOL / 500 mg
 *
 * ASPIRIN 300MG, PARACETAMOL 200MG
 * -> ASPIRIN + PARACETAMOL / 300 mg + 200 mg
 *
 * If any component cannot be confidently parsed, no partial
 * ingredient/strength mapping is saved.
 */
function parseComposition(composition: string): CompositionResult {
  const original = composition.trim();

  if (!original) {
    return {
      genericName: "",
      strength: "",
      parsed: false,
    };
  }

  const components = original
    .replace(/[.…]+/g, " ")
    .split(/[;,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!components.length) {
    return {
      genericName: "",
      strength: "",
      parsed: false,
    };
  }

  const parsedComponents: Array<{
    ingredient: string;
    strength: string;
  }> = [];

  const strengthPattern =
    /(\d+(?:\.\d+)?\s*(?:mcg|μg|µg|mg|g|ml|iu)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mcg|μg|µg|mg|g|ml|iu))*)$/i;

  for (const component of components) {
    const normalized = component.replace(/\s+/g, " ").trim();
    const match = normalized.match(strengthPattern);

    if (!match || match.index === undefined) {
      return {
        genericName: "",
        strength: "",
        parsed: false,
      };
    }

    const ingredient = normalized
      .slice(0, match.index)
      .replace(/[\s.:–—-]+$/g, "")
      .trim();

    const strength = normalizeUnit(match[1]);

    if (!ingredient || !strength) {
      return {
        genericName: "",
        strength: "",
        parsed: false,
      };
    }

    parsedComponents.push({ ingredient, strength });
  }

  return {
    genericName: parsedComponents
      .map((item) => item.ingredient)
      .join(" + "),
    strength: parsedComponents
      .map((item) => item.strength)
      .join(" + "),
    parsed: true,
  };
}

function buildDescription(parts: string[]): string {
  const description = parts
    .filter(Boolean)
    .join(" | ");

  if (description.length <= DESCRIPTION_MAX_LENGTH) {
    return description;
  }

  return description.slice(0, DESCRIPTION_MAX_LENGTH - 3).trimEnd() + "...";
}

async function search(term: string) {
  const output = await curlRequest([
    "--get",
    "--data-urlencode",
    `search=${term}`,
    "--data-urlencode",
    "_type=brand name",
    `${BASE_URL}/productView.php`,
  ]);

  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error(
      `DRAP returned an invalid response for "${term}".`,
    );
  }

  const jsonText = output
    .slice(jsonStart, jsonEnd + 1)
    .replace(/^\uFEFF/, "")
    .replace(/\0/g, "")
    .trim();

  const data = JSON.parse(jsonText) as {
    results?: Array<{ id: string; text: string }>;
  };

  return data.results ?? [];
}

async function details(registrationNumber: string) {
  return curlRequest([
    "--request",
    "POST",
    "--header",
    "Content-Type: application/x-www-form-urlencoded",
    "--header",
    "Accept: text/html",
    "--data-urlencode",
    `webRegNo=${registrationNumber}`,
    `${BASE_URL}/productView.php`,
  ]);
}

async function main() {
  const registrations = new Map<string, string>();

  console.log("PharmaSathi DRAP Catalogue Importer");
  console.log(`Mode: ${APPLY_CHANGES ? "LIVE IMPORT" : "DRY RUN"}`);
  console.log(`Update existing PENDING records: ${UPDATE_EXISTING}`);
  console.log(`Search terms: ${SEARCH_TERMS.join(", ")}`);
  console.log("");

  if (UPDATE_EXISTING && !APPLY_CHANGES) {
    console.log(
      "Note: --update-existing has no effect without --apply.",
    );
  }

  for (const term of SEARCH_TERMS) {
    console.log(`Searching DRAP: ${term}`);

    try {
      const results = await search(term);

      for (const item of results) {
        const id = item.id?.trim();
        const name = item.text?.trim();

        if (id && name) {
          registrations.set(id, name);
        }
      }

      console.log(`  Found ${results.length} results.`);
    } catch (error) {
      console.error(`Search error (${term}):`, error);
    }

    await delay(500);
  }
  if (registrationFilter.length) {
  const allowedRegistrations = new Set(registrationFilter);

  for (const registrationNumber of registrations.keys()) {
    if (!allowedRegistrations.has(registrationNumber)) {
      registrations.delete(registrationNumber);
    }
  }

  console.log(
    `Targeted registration filter: ${registrationFilter.join(", ")}`,
  );
}

  console.log(`\nFound ${registrations.size} unique registration numbers.`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let compositionUnparsed = 0;
  let manufacturerMissing = 0;

  for (const [registrationNumber, searchName] of registrations) {
    try {
      const html = await details(registrationNumber);

      const usedFor = field(html, "Used For");

      if (usedFor.toLowerCase() !== "human") {
        console.log(
          `Skipped ${registrationNumber}: Used For = "${usedFor || "Not found"}"`,
        );
        skipped++;
        continue;
      }

      const brandName = field(html, "Product Name") || searchName;
      const sourceCompany = field(html, "Company Name");
      const sourceCompanyAddress = field(html, "Company Address");
      const dosageForm = field(html, "Dosage Form");
      const composition = field(html, "Composition");
      const registrationStatus = field(html, "Registration Status");

      if (!brandName) {
        console.log(`Skipped ${registrationNumber}: Product name missing.`);
        skipped++;
        continue;
      }

      const manufacturer = isPlaceholder(sourceCompany)
        ? ""
        : sourceCompany;

      const compositionResult = parseComposition(composition);

      if (!compositionResult.parsed) {
        compositionUnparsed++;
      }

      if (!manufacturer) {
        manufacturerMissing++;
      }

      const description = buildDescription([
        "Source: DRAP public product registry",
        `Registration status: ${registrationStatus || "Not provided"}`,
        `Used for: ${usedFor}`,
        `Original composition: ${composition || "Not provided"}`,
        `Source company: ${sourceCompany || "Not provided"}`,
        `Source company address: ${sourceCompanyAddress || "Not provided"}`,
        ...(!compositionResult.parsed
          ? ["Composition parsing: Manual review required"]
          : []),
        ...(!manufacturer
          ? ["Manufacturer verification: Missing or placeholder source value"]
          : []),
      ]);

      const data = {
        brandName,
        genericName: compositionResult.genericName,
        strength: compositionResult.strength,
        dosageForm,
        manufacturer,
        registrationNumber,
        description,
        status: "PENDING" as const,
        isActive: true,
      };

      const existing = await prisma.masterMedicine.findFirst({
        where: { registrationNumber },
        select: {
          id: true,
          status: true,
          isActive: true,
        },
      });

      if (existing) {
        if (
          !UPDATE_EXISTING ||
          existing.status !== "PENDING" ||
          !existing.isActive
        ) {
          console.log(
            `Skipped existing ${registrationNumber}: ` +
              `status=${existing.status}, active=${existing.isActive}.`,
          );
          skipped++;
          continue;
        }

        if (APPLY_CHANGES) {
          await prisma.masterMedicine.update({
            where: { id: existing.id },
            data,
          });

          updated++;
        } else {
          console.log(
            `Would update PENDING record: ${registrationNumber} - ${brandName}`,
          );
        }

        continue;
      }

      if (APPLY_CHANGES) {
        await prisma.masterMedicine.create({ data });
        created++;
      } else {
        console.log(
          `Would create: ${registrationNumber} - ${brandName}`,
        );
      }

      if (!compositionResult.parsed) {
        console.log(
          `  Manual composition review required: ${composition || "Missing"}`,
        );
      }

      if (!manufacturer) {
        console.log(
          `  Manufacturer missing/placeholder: ${sourceCompany || "Not provided"}`,
        );
      }
    } catch (error) {
      failed++;
      console.error(`Failed ${registrationNumber}:`, error);
    }

    await delay(350);
  }

  console.log("\nDRAP import finished.");
  console.log({
    discovered: registrations.size,
    created,
    updated,
    skipped,
    failed,
    compositionUnparsed,
    manufacturerMissing,
    databaseChangesApplied: APPLY_CHANGES,
  });
}

main()
  .catch((error) => {
    console.error("Importer failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
