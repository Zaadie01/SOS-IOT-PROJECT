#ifndef SENSORS_H
#define SENSORS_H

#include <zephyr/drivers/sensor.h>

int sensors_init(void);
int sensors_read_temp(struct sensor_value *val);
int sensors_read_accel(struct sensor_value *val);  // val[3]: x,y,z
float sensor_value_to_float(const struct sensor_value *val);

#endif // SENSORS_H
