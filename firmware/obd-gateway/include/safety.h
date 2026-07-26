#pragma once

/**
 * Safety policy for public firmware (ewd-volvo / OBD gateway).
 *
 * ALLOWED by default:
 *  - OBD-II Mode 01 supported-PID discovery + live signals
 *  - UDS DiagnosticSessionControl (default / extended where needed for read)
 *  - UDS TesterPresent
 *  - UDS ReadDTCInformation (0x19)
 *  - Passive ECU online probe (short request + timeout)
 *
 * FORBIDDEN in this public tree:
 *  - SecurityAccess seed/key algorithms or bypass
 *  - RoutineControl / write DID / coding / flash
 *  - Automatic ClearDiagnosticInformation without explicit user confirm
 *
 * Clear DTC: only when HTTP/WS request includes confirm=1 AND allow_clear=1
 * after an interactive UI double-confirm on the website.
 */

enum class ObdOpClass : uint8_t {
  ReadLive = 0,
  ReadDtc = 1,
  EcuProbe = 2,
  ClearDtc = 3,  // gated
  Forbidden = 255,
};

inline bool obdOpAllowed(ObdOpClass op, bool clearConfirmed) {
  switch (op) {
    case ObdOpClass::ReadLive:
    case ObdOpClass::ReadDtc:
    case ObdOpClass::EcuProbe:
      return true;
    case ObdOpClass::ClearDtc:
      return clearConfirmed;
    default:
      return false;
  }
}
