export type ConfScalar = string | number | boolean;

export interface ConfSection {
  name: string;
  values: Record<string, ConfScalar>;
}

function parseScalar(rawValue: string): ConfScalar {
  const value = rawValue.trim();

  if (value.startsWith("\"") && value.endsWith("\"")) {
    return JSON.parse(value);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

export function parseConf(raw: string): ConfSection[] {
  const sections: ConfSection[] = [];
  let currentSection: ConfSection | null = null;

  for (const originalLine of raw.split(/\r?\n/)) {
    const line = originalLine.trim();

    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      currentSection = {
        name: sectionMatch[1],
        values: {},
      };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection) {
      throw new Error(`Config entry found outside of a section: ${originalLine}`);
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 0) {
      throw new Error(`Invalid config line: ${originalLine}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      throw new Error(`Config key is missing: ${originalLine}`);
    }

    currentSection.values[key] = parseScalar(value);
  }

  return sections;
}
