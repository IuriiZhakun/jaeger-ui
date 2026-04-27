// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import { IAttribute, IOtelSpan } from '../types/otel';
import { SchemaValuesConfig, SchemaValuesFieldConfig, SchemaValuesRegistryConfig } from '../types/config';

const SUPPORTED_ENCODING = 'schema_values_json';

const ENVELOPE_KEYS = [
  'payload.schema_id',
  'payload.type_id',
  'payload.encoding',
  'payload.values_json',
] as const;

type SchemaValuesEnvelopeKey = (typeof ENVELOPE_KEYS)[number];

type SchemaValuesEnvelope = Record<SchemaValuesEnvelopeKey, string>;

type TJsonObject = Record<string, unknown>;

type TEnvelopeSource = {
  label: string;
  attributes: ReadonlyArray<IAttribute>;
};

type TDecodedSchemaValuesPayload = {
  decoded: TJsonObject;
  displayName: string;
  encoding: string;
  schemaId: string;
  source: string;
  status: 'decoded';
  typeId: string;
};

type TSchemaValuesPayloadError = {
  errorCode: string;
  errorMessage: string;
  schemaId?: string;
  source: string;
  status: 'error';
  typeId?: string;
};

export type TSchemaValuesPayload = TDecodedSchemaValuesPayload | TSchemaValuesPayloadError;

function attributesByKey(attributes: ReadonlyArray<IAttribute>): Map<string, IAttribute['value']> {
  return new Map(attributes.map(attribute => [attribute.key, attribute.value]));
}

function buildEnvelope(source: TEnvelopeSource): SchemaValuesEnvelope | TSchemaValuesPayloadError | null {
  const attributes = attributesByKey(source.attributes);
  const hasEnvelopeKey = ENVELOPE_KEYS.some(key => attributes.has(key));
  if (!hasEnvelopeKey) {
    return null;
  }

  const envelope: Partial<SchemaValuesEnvelope> = {};
  const missingKeys: string[] = [];
  const nonStringKeys: string[] = [];
  ENVELOPE_KEYS.forEach(key => {
    const value = attributes.get(key);
    if (value === undefined || value === null) {
      missingKeys.push(key);
    } else if (typeof value !== 'string' || value.length === 0) {
      nonStringKeys.push(key);
    } else {
      envelope[key] = value;
    }
  });

  if (missingKeys.length > 0 || nonStringKeys.length > 0) {
    return {
      errorCode: 'invalid_envelope',
      errorMessage: [
        missingKeys.length > 0 ? `missing ${missingKeys.join(', ')}` : '',
        nonStringKeys.length > 0 ? `non-string ${nonStringKeys.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
      source: source.label,
      status: 'error',
    };
  }

  return envelope as SchemaValuesEnvelope;
}

function registryBySchemaId(
  config: SchemaValuesConfig | undefined,
  schemaId: string
): SchemaValuesRegistryConfig | null {
  if (config?.enabled === false) {
    return null;
  }
  return config?.registries?.find(registry => registry.schemaId === schemaId) ?? null;
}

function fail(errorCode: string, errorMessage: string): never {
  throw Object.assign(new Error(errorMessage), { errorCode });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_field_definition', `${name} must be a non-empty string`);
  }
  return value;
}

function typeDefinition(registry: SchemaValuesRegistryConfig, typeId: string) {
  const definition = registry.types?.[typeId];
  if (!definition) {
    fail('unknown_type_id', `unknown schema-values type ${typeId}`);
  }
  if (!Array.isArray(definition.fields)) {
    fail('invalid_field_definition', `schema-values type ${typeId} must define fields array`);
  }
  return definition;
}

function fieldName(field: SchemaValuesFieldConfig, typeId: string, index: number): string {
  return requireString(field.name, `${typeId}.fields[${index}].name`);
}

function invalidValue(typeId: string, fieldNameValue: string, valueIndex: number, expected: string): never {
  fail('invalid_value', `${typeId}.${fieldNameValue} at values[${valueIndex}] ${expected}`);
}

function decodeKvPairs(field: SchemaValuesFieldConfig, value: unknown): TJsonObject {
  if (!Array.isArray(value)) {
    invalidValue(String(field.name), String(field.name), 0, 'must be a kv pair array');
  }
  const policy = field.duplicateKeyPolicy;
  if (policy !== 'preserve_array' && policy !== 'fail') {
    fail(
      'invalid_field_definition',
      'kv_pairs field must define duplicateKeyPolicy as preserve_array or fail'
    );
  }

  const decoded: TJsonObject = {};
  value.forEach((pair, pairIndex) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
      fail('invalid_kv_pair', 'kv_pairs entries must be [string_key, value] arrays');
    }
    const key = pair[0];
    const itemValue = pair[1];
    if (Object.hasOwn(decoded, key)) {
      if (policy === 'fail') {
        fail('duplicate_kv_key', `duplicate key ${key} rejected by schema policy at pair ${pairIndex}`);
      }
      const existing = decoded[key];
      decoded[key] = Array.isArray(existing) ? [...existing, itemValue] : [existing, itemValue];
    } else {
      decoded[key] = itemValue;
    }
  });
  return decoded;
}

function decodeTypeValues(
  registry: SchemaValuesRegistryConfig,
  typeId: string,
  values: ReadonlyArray<unknown>
): TJsonObject {
  const definition = typeDefinition(registry, typeId);
  const { fields } = definition;
  if (values.length > fields.length) {
    fail('extra_values', 'payload has more positional values than schema fields');
  }

  const decoded: TJsonObject = {};
  fields.forEach((field, index) => {
    const name = fieldName(field, typeId, index);
    if (index >= values.length) {
      if (field.optional) {
        decoded[name] = null;
        return;
      }
      fail('missing_required_value', `missing required positional value for ${typeId}.${name}`);
    }
    decoded[name] = decodeFieldValue(registry, typeId, field, values[index], index);
  });
  return decoded;
}

function decodeFieldValue(
  registry: SchemaValuesRegistryConfig,
  typeId: string,
  field: SchemaValuesFieldConfig,
  value: unknown,
  valueIndex: number
): unknown {
  const name = fieldName(field, typeId, valueIndex);
  switch (field.type) {
    case 'string':
      if (typeof value === 'string') return value;
      invalidValue(typeId, name, valueIndex, 'must be a string');
      break;
    case 'number':
      if (typeof value === 'number') return value;
      invalidValue(typeId, name, valueIndex, 'must be a number');
      break;
    case 'integer':
      if (Number.isInteger(value)) return value;
      invalidValue(typeId, name, valueIndex, 'must be an integer');
      break;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      invalidValue(typeId, name, valueIndex, 'must be a boolean');
      break;
    case 'array':
      if (Array.isArray(value)) return value;
      invalidValue(typeId, name, valueIndex, 'must be an array');
      break;
    case 'kv_pairs':
      return decodeKvPairs(field, value);
    case 'rows': {
      if (!Array.isArray(value)) {
        invalidValue(typeId, name, valueIndex, 'must be a rows array');
      }
      const rowType = requireString(field.rowType, `${typeId}.${name}.rowType`);
      return value.map(row => {
        if (!Array.isArray(row)) {
          fail('invalid_nested_row', `${typeId}.${name} rows must contain positional arrays`);
        }
        return decodeTypeValues(registry, rowType, row);
      });
    }
    case 'object': {
      if (!Array.isArray(value)) {
        invalidValue(typeId, name, valueIndex, 'must be an object positional array');
      }
      const objectType = requireString(field.typeId, `${typeId}.${name}.typeId`);
      return decodeTypeValues(registry, objectType, value);
    }
    default:
      fail('invalid_field_definition', `unsupported field type ${field.type}`);
  }
}

function decodeEnvelope(
  config: SchemaValuesConfig | undefined,
  source: string,
  envelope: SchemaValuesEnvelope
): TSchemaValuesPayload {
  const schemaId = envelope['payload.schema_id'];
  const typeId = envelope['payload.type_id'];
  try {
    const registry = registryBySchemaId(config, schemaId);
    if (!registry) {
      fail('unknown_schema_id', `unknown schema-values schema ${schemaId}`);
    }
    if (envelope['payload.encoding'] !== SUPPORTED_ENCODING) {
      fail('unsupported_encoding', `unsupported payload encoding ${envelope['payload.encoding']}`);
    }

    let values: unknown;
    try {
      values = JSON.parse(envelope['payload.values_json']);
    } catch (error) {
      fail('malformed_values_json', `payload.values_json is not valid JSON: ${String(error)}`);
    }
    if (!Array.isArray(values)) {
      fail('non_array_values_json', 'payload.values_json must decode to a JSON array');
    }

    const decoded = decodeTypeValues(registry, typeId, values);
    const displayName = String(typeDefinition(registry, typeId).displayName ?? typeId);
    return {
      decoded,
      displayName,
      encoding: envelope['payload.encoding'],
      schemaId,
      source,
      status: 'decoded',
      typeId,
    };
  } catch (error) {
    return {
      errorCode: String((error as { errorCode?: unknown }).errorCode ?? 'schema_values_decode_failed'),
      errorMessage: error instanceof Error ? error.message : String(error),
      schemaId,
      source,
      status: 'error',
      typeId,
    };
  }
}

export function materializeSchemaValuesPayloads(
  span: IOtelSpan,
  config: SchemaValuesConfig | undefined
): TSchemaValuesPayload[] {
  if (config?.enabled === false) {
    return [];
  }

  const sources: TEnvelopeSource[] = [
    { attributes: span.attributes, label: 'span attributes' },
    ...span.events.map((event, index) => ({
      attributes: event.attributes,
      label: `${event.name || 'event'} attributes #${index + 1}`,
    })),
  ];

  return sources.flatMap(source => {
    const envelope = buildEnvelope(source);
    if (!envelope) {
      return [];
    }
    if ('status' in envelope) {
      return [envelope];
    }
    return [decodeEnvelope(config, source.label, envelope)];
  });
}
