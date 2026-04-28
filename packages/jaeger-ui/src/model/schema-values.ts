// Copyright (c) 2026 The Jaeger Authors.
// SPDX-License-Identifier: Apache-2.0

import { IAttribute, IOtelSpan } from '../types/otel';
import { SchemaValuesConfig, SchemaValuesFieldConfig, SchemaValuesRegistryConfig } from '../types/config';

const REGISTRY_MESSAGE_CARRIER_KEY = 'sv';

type TJsonObject = Record<string, unknown>;

type TAttributeSource = {
  label: string;
  attributes: ReadonlyArray<IAttribute>;
};

type TDecodedSchemaValuesPayload = {
  decoded: TJsonObject;
  displayName: string;
  messageTypeId: string;
  schemaId: string;
  source: string;
  status: 'decoded';
  typeId?: string;
};

type TSchemaValuesPayloadError = {
  errorCode: string;
  errorMessage: string;
  messageTypeId?: string;
  schemaId?: string;
  source: string;
  status: 'error';
};

export type TSchemaValuesPayload = TDecodedSchemaValuesPayload | TSchemaValuesPayloadError;

function fail(errorCode: string, errorMessage: string): never {
  throw Object.assign(new Error(errorMessage), { errorCode });
}

function invalidValue(typeId: string, fieldName: string, valueIndex: number, expected: string): never {
  fail('invalid_value', `${typeId}.${fieldName} at values[${valueIndex}] ${expected}`);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_field_definition', `${name} must be a non-empty string`);
  }
  return value;
}

function attributesByKey(attributes: ReadonlyArray<IAttribute>): Map<string, IAttribute['value']> {
  return new Map(attributes.map(attribute => [attribute.key, attribute.value]));
}

function registryMessageCarrier(source: TAttributeSource): string | TSchemaValuesPayloadError | null {
  const value = attributesByKey(source.attributes).get(REGISTRY_MESSAGE_CARRIER_KEY);
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return {
      errorCode: 'invalid_registry_message',
      errorMessage: `${REGISTRY_MESSAGE_CARRIER_KEY} must be a non-empty string`,
      source: source.label,
      status: 'error',
    };
  }
  return value;
}

function messageTypeIdKey(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  fail('invalid_registry_message', 'messageTypeId must be a string or integer');
}

function registryMessageByMessageTypeId(config: SchemaValuesConfig, messageTypeId: string) {
  const matches = (config.registries ?? [])
    .map(registry => ({ definition: registry.messages?.[messageTypeId], registry }))
    .filter(match => match.definition);

  if (matches.length > 1) {
    fail('ambiguous_message_type_id', `messageTypeId ${messageTypeId} is defined by multiple registries`);
  }
  return matches[0] ?? null;
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

function decodeTypeValues(
  registry: SchemaValuesRegistryConfig,
  typeId: string,
  values: ReadonlyArray<unknown>
): TJsonObject {
  const { fields } = typeDefinition(registry, typeId);
  if (values.length > fields.length) {
    fail('extra_values', 'payload has more positional values than schema fields');
  }

  function decodeFieldValue(field: SchemaValuesFieldConfig, value: unknown, valueIndex: number): unknown {
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
      case 'object': {
        if (!Array.isArray(value)) {
          invalidValue(typeId, name, valueIndex, 'must be an object positional array');
        }
        const objectType = requireString(field.typeId, `${typeId}.${name}.typeId`);
        return decodeTypeValues(registry, objectType, value);
      }
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
      default:
        fail('invalid_field_definition', `unsupported field type ${field.type}`);
    }
  }

  const decoded: TJsonObject = {};
  fields.forEach((field, index) => {
    const name = fieldName(field, typeId, index);
    const value = values[index];
    if (index >= values.length || (value === null && field.optional)) {
      if (field.optional) {
        decoded[name] = null;
        return;
      }
      fail('missing_required_value', `missing required positional value for ${typeId}.${name}`);
    }
    decoded[name] = decodeFieldValue(field, value, index);
  });
  return decoded;
}

function decodeRegistryMessageCarrier(
  config: SchemaValuesConfig,
  source: string,
  carrierJson: string
): TSchemaValuesPayload {
  let messageTypeId = '';
  let schemaId: string | undefined;
  try {
    let values: unknown;
    try {
      values = JSON.parse(carrierJson);
    } catch (error) {
      fail(
        'malformed_registry_message_json',
        `${REGISTRY_MESSAGE_CARRIER_KEY} is not valid JSON: ${String(error)}`
      );
    }
    if (!Array.isArray(values) || values.length === 0) {
      fail(
        'invalid_registry_message',
        `${REGISTRY_MESSAGE_CARRIER_KEY} must decode to a non-empty JSON array`
      );
    }

    messageTypeId = messageTypeIdKey(values[0]);
    const match = registryMessageByMessageTypeId(config, messageTypeId);
    if (!match?.definition) {
      fail('unknown_message_type_id', `unknown schema-values messageTypeId ${messageTypeId}`);
    }

    const { definition, registry } = match;
    schemaId = registry.schemaId;

    if (definition.typeId) {
      if (definition.argTypeIds) {
        fail(
          'invalid_message_definition',
          'registry message must define either typeId or argTypeIds, not both'
        );
      }
      const typeId = requireString(definition.typeId, `messages.${messageTypeId}.typeId`);
      const decoded = decodeTypeValues(registry, typeId, values.slice(1));
      const displayName = String(
        definition.displayName ?? typeDefinition(registry, typeId).displayName ?? typeId
      );
      return {
        decoded,
        displayName,
        messageTypeId,
        schemaId,
        source,
        status: 'decoded',
        typeId,
      };
    }

    if (!Array.isArray(definition.argTypeIds) || definition.argTypeIds.length === 0) {
      fail('invalid_message_definition', 'registry message must define typeId or non-empty argTypeIds');
    }

    const payloadArgs = values.slice(1);
    if (payloadArgs.length !== definition.argTypeIds.length) {
      fail('message_arg_count_mismatch', 'registry message payload argument count does not match argTypeIds');
    }

    const decodedArgs = definition.argTypeIds.map((rawTypeId, index) => {
      const typeId = requireString(rawTypeId, `messages.${messageTypeId}.argTypeIds[${index}]`);
      const argValues = payloadArgs[index];
      if (!Array.isArray(argValues)) {
        fail('invalid_registry_message_arg', 'registry message argument value must be a positional array');
      }
      return {
        displayName: String(typeDefinition(registry, typeId).displayName ?? typeId),
        typeId,
        value: decodeTypeValues(registry, typeId, argValues),
      };
    });

    const decoded: TJsonObject = { args: decodedArgs };
    if (typeof definition.template === 'string') {
      decoded.template = definition.template;
    }

    return {
      decoded,
      displayName: String(definition.displayName ?? messageTypeId),
      messageTypeId,
      schemaId,
      source,
      status: 'decoded',
    };
  } catch (error) {
    return {
      errorCode: String((error as { errorCode?: unknown }).errorCode ?? 'schema_values_decode_failed'),
      errorMessage: error instanceof Error ? error.message : String(error),
      messageTypeId: messageTypeId || undefined,
      schemaId,
      source,
      status: 'error',
    };
  }
}

function sourcesFromSpan(span: IOtelSpan): TAttributeSource[] {
  return [
    { attributes: span.attributes ?? [], label: 'span attributes' },
    ...(span.events ?? []).map((event, index) => ({
      attributes: event.attributes ?? [],
      label: `${event.name || 'event'} attributes #${index + 1}`,
    })),
  ];
}

export function materializeSchemaValuesPayloads(
  span: IOtelSpan,
  config: SchemaValuesConfig | undefined
): TSchemaValuesPayload[] {
  if (config?.enabled !== true) {
    return [];
  }

  return sourcesFromSpan(span).flatMap(source => {
    const carrier = registryMessageCarrier(source);
    if (!carrier) {
      return [];
    }
    return typeof carrier === 'string'
      ? [decodeRegistryMessageCarrier(config, source.label, carrier)]
      : [carrier];
  });
}
