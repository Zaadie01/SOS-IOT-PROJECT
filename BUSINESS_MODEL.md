## 1. Key Actors

### Device User
A person carrying the SOS IoT device.  
The user can press the emergency button in dangerous situations to send an alert.

### Caregiver / Emergency Contact
A person responsible for monitoring the safety of the device user.  
They receive alerts and can monitor the device through the application dashboard.

### Gateway Device
A technical actor responsible for receiving data from IoT nodes and forwarding it to the cloud application.

### Cloud Application
The backend system that receives, processes, and stores data from the gateways.

---

## 2. Products

### SOS IoT Device
A wearable device built using the HARDWARIO Core Module.  
It includes:
- SOS emergency button
- temperature sensor

The device collects data and transmits it to the gateway.

### Gateway Application
A gateway implemented using **Node-RED**  
Its responsibilities include:
- receiving data from IoT nodes
- performing data downsampling
- temporarily storing data locally
- forwarding data to the cloud application

### Cloud Application
A cloud-based backend.  
It handles:
- receiving data from gateways
- storing and processing data
- managing multiple gateways

### Web Dashboard
A web interface that allows users to:
- monitor device status
- view historical data
- observe system alerts

---

## 3. Business Use Cases

### Emergency SOS Alert
The device user presses the SOS button.  
The IoT node sends the alert to the gateway, which forwards it to the cloud application where it is stored and processed.

### Environmental Monitoring
The device periodically measures temperature and sends the data to the gateway for processing and storage.

### Data Storage and Synchronization
The gateway stores collected data locally when internet connectivity is unavailable.  
Once connectivity is restored, the stored data is sent to the cloud.

### System Monitoring
Caregivers and administrators can monitor the device status, sensor data, and system health through the application dashboard.
