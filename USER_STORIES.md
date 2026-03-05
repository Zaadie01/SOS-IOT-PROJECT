## 1. Device User 
User:

I want to press the SOS button,
so that an emergency alert is sent immediately to the system

System behavior:
	
  •	IoT node detects button press
	
  •	Gateway sends event to cloud
	
  •	Cloud stores alert
	
  •	Caregiver is notified


## 2. Fall Detection
Device User:

I want the device to automatically detect a fall,
so that help can be requested even if I cannot press the button

System behavior:
	
  •	Accelerometer detects sudden movement
	
  •	Gateway sends alert


## 3. Device Monitoring

Caretaker:

I want to see the last known statues of the device,
So I know the user is safe

Dashboard shows:
	
  •	last button press
	
  •	last device activity
	
  •	temperature
	
  •	connection status


## 4. Cloud Data Storage

Admin:

I want the cloud application to store data from multiple gateways,
So the system can scale to many devices

## 5. Gateway Dashboard
System Operator:

I want a dashboard showing the gateway status and the queued data, so that I can monitor system health

Dashboard shows:
	
  •	connection to cloud
	
  •	unsent records
	
  •	latest temperature
	
  •	button history
