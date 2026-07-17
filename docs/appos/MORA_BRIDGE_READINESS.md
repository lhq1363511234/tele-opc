# Mora Bridge Readiness

Mora remains frozen in this phase. Tele-OPC External AppOS exposes Mora-compatible contracts without importing or modifying Mora code.

## Implemented Compatibility

| Requirement | Status |
| --- | --- |
| `MoraIntentPacket` schema | Implemented in `src/appos/contracts/schemas.ts` |
| `BusinessContract` conversion | Implemented by `createBusinessContractFromMoraIntent` |
| `ApplicationEvent` schema | Implemented in `src/appos/contracts/schemas.ts` |
| Simulated Mora fixture | `tests/fixtures/mora-intent-content-matrix.json` |
| Mora code changes | None |

## Future Swap

Current path:

```text
Feishu/opctoai -> AppOS Gateway -> BusinessContract -> Workflow Router
```

Future path:

```text
Feishu/opctoai -> Mora -> BusinessContract -> AppOS Gateway -> Workflow Router
```

The AppOS path after `BusinessContract` should not need to change.

