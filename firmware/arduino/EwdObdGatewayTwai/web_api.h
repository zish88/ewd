#pragma once
#include <Arduino.h>

void webApiBegin();
void webApiLoop();
/** Last scan JSON cached for GET /scan */
void webApiSetScanJson(const String& json);
String webApiScanJson();
/** Cached GET /signals and GET /health bodies (updated by main loop). */
void webApiSetSignalsJson(const String& json);
void webApiSetHealthJson(const String& json);
bool webApiScanRequested();
void webApiClearScanRequest();
bool webApiClearRequested(String* ecuOut);
void webApiClearClearRequest();
