// sensors.c - Temperature and 3-axis accelerometer for SOS IoT Device
// HARDWARIO Core Module: Assume Si7021 temp (I2C), BMI270 accel (I2C/SPI)

#include <zephyr/kernel.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/sys/printk.h>
#include "sensors.h"

#define TEMP_SENSOR DT_NODELABEL(si7021)  // Example I2C temp
#define ACCEL_SENSOR DT_NODELABEL(bmi270) // Example accel

static const struct device *temp_dev;
static const struct device *accel_dev;

int sensors_init(void) {
    // Temp sensor
    temp_dev = DEVICE_DT_GET(TEMP_SENSOR);
    if (!device_is_ready(temp_dev)) {
        printk("Temp sensor not ready\n");
        return -1;
    }

    // Accel sensor
    accel_dev = DEVICE_DT_GET(ACCEL_SENSOR);
    if (!device_is_ready(accel_dev)) {
        printk("Accel sensor not ready\n");
        return -1;
    }

    // Configure accel: 100Hz, range +/-4g
    sensor_attr_set(accel_dev, SENSOR_CHAN_ACCEL_XYZ,
                    SENSOR_ATTR_SAMPLING_FREQUENCY, 100);
    sensor_attr_set(accel_dev, SENSOR_CHAN_ACCEL_XYZ,
                    SENSOR_ATTR_FULL_SCALE, 4);

    printk("Sensors initialized\n");
    return 0;
}

int sensors_read_temp(struct sensor_value *val) {
    struct sensor_value temp;
    int ret = sensor_sample_fetch_chan(temp_dev, SENSOR_CHAN_AMBIENT_TEMP);
    if (ret < 0) {
        printk("Temp read failed: %d\n", ret);
        return ret;
    }
    sensor_channel_get(temp_dev, SENSOR_CHAN_AMBIENT_TEMP, &temp);
    *val = temp;
    return 0;
}

int sensors_read_accel(struct sensor_value *val) {  // val[3]: x,y,z
    struct sensor_value accel[3];
    int ret = sensor_sample_fetch_chan(accel_dev, SENSOR_CHAN_ACCEL_XYZ);
    if (ret < 0) {
        printk("Accel read failed: %d\n", ret);
        return ret;
    }
    sensor_channel_get(accel_dev, SENSOR_CHAN_ACCEL_X, &accel[0]);
    sensor_channel_get(accel_dev, SENSOR_CHAN_ACCEL_Y, &accel[1]);
    sensor_channel_get(accel_dev, SENSOR_CHAN_ACCEL_Z, &accel[2]);
    val[0] = accel[0];
    val[1] = accel[1];
    val[2] = accel[2];
    return 0;
}

float sensor_value_to_float(const struct sensor_value *val) {
    return val->val1 + val->val2 / 1000000.0f;
}
