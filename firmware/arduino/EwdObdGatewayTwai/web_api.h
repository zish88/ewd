#pragma once
#include <Arduino.h>

void webApiBegin();
void webApiLoop();
/** Last scan JSON cached for GET /scan */
void webApiSetScanJson(const String& json);
String webApiScanJson();
bool webApiScanRequested();
void webApiClearScanRequest();
bool webApiClearRequested(String* ecuOut);
void webApiClearClearRequest();
