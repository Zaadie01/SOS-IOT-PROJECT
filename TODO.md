# SOS IoT Project TODO (Execution Plan)

## 1) Firmware (HARDWARIO TOWER/Core)
- [ ] Fix compile/runtime issues in `firmware/src/main.c`
- [ ] Keep payload contract aligned with UART serializer in `firmware/src/uart_comm.*`
- [ ] Validate accelerometer + temperature read flow in `firmware/src/sensors.*`

## 2) Gateway (Node-RED + SQLite)
- [ ] Implement `gateway/sqlite-schema.sql` with `alerts` and `heartbeats` tables
- [ ] Implement `gateway/flows.json`:
  - [ ] Serial input
  - [ ] JSON parse/normalize
  - [ ] Route SOS vs heartbeat
  - [ ] Persist to SQLite
  - [ ] Forward to cloud backend endpoints

## 3) Cloud Backend (Express)
- [ ] Ensure alert model and APIs support SOS + heartbeat ingestion/query
- [ ] Finalize routes in `cloud/backend/src/routes/api.js` and `routes/gateways.js`
- [ ] Ensure `cloud/backend/src/server.js` wiring/middleware is correct

## 4) Cloud Frontend (React)
- [ ] Build API service wrapper in `cloud/frontend/src/services/api.js`
- [ ] Build dashboard and SOS view components
- [ ] Wire app shell in `cloud/frontend/src/App.js`

## 5) Git Delivery
- [ ] Create branch `SOS`
- [ ] Commit all implementation
- [ ] Push branch to `origin/SOS`
