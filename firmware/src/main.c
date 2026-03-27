// SOS IoT Device Firmware for HARDWARIO TOWER/Core Module
// Features: SOS button, 3-axis accel (fall detection), temperature sensor, UART to gateway

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/sys/printk.h>
#include <math.h>

#include "sensors.h"
#include "uart_comm.h"

// Device ID (unique per node)
#define DEVICE_ID "SOS_NODE_001"

// Heartbeat interval
#define HEARTBEAT_INTERVAL K_SECONDS(30)

// Simple free-fall threshold (g)
#define FREEFALL_THRESHOLD_G 0.25f

// GPIO aliases expected in devicetree overlay
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static struct gpio_callback button_cb_data;

static const struct device *uart_dev;

// Forward declarations
static void send_payload(const char *type);
static void sos_button_handler(const struct device *port, struct gpio_callback *cb, uint32_t pins);

static int init_peripherals(void)
{
    int ret;

    // Use chosen console UART (works on HARDWARIO TOWER/Core configs that map this)
    uart_dev = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
    if (!device_is_ready(uart_dev)) {
        printk("UART device not ready\n");
        return -1;
    }
    uart_comm_init(uart_dev);

    if (!device_is_ready(button.port) || !device_is_ready(led.port)) {
        printk("GPIO device not ready\n");
        return -1;
    }

    ret = gpio_pin_configure_dt(&button, GPIO_INPUT);
    if (ret < 0) {
        printk("Button config failed: %d\n", ret);
        return ret;
    }

    ret = gpio_pin_interrupt_configure_dt(&button, GPIO_INT_EDGE_TO_ACTIVE);
    if (ret < 0) {
        printk("Button IRQ config failed: %d\n", ret);
        return ret;
    }

    gpio_init_callback(&button_cb_data, sos_button_handler, BIT(button.pin));
    ret = gpio_add_callback(button.port, &button_cb_data);
    if (ret < 0) {
        printk("Button callback add failed: %d\n", ret);
        return ret;
    }

    ret = gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
    if (ret < 0) {
        printk("LED config failed: %d\n", ret);
        return ret;
    }

    ret = sensors_init();
    if (ret < 0) {
        printk("Sensors init failed: %d\n", ret);
        return ret;
    }

    return 0;
}

static void send_payload(const char *type)
{
    struct sensor_value temp_val;
    struct sensor_value accel_val[3] = {0};

    if (sensors_read_temp(&temp_val) < 0) {
        temp_val.val1 = 0;
        temp_val.val2 = 0;
    }

    if (sensors_read_accel(accel_val) < 0) {
        accel_val[0].val1 = accel_val[1].val1 = accel_val[2].val1 = 0;
        accel_val[0].val2 = accel_val[1].val2 = accel_val[2].val2 = 0;
    }

    sos_payload_t payload = {0};
    snprintk(payload.device_id, sizeof(payload.device_id), "%s", DEVICE_ID);
    snprintk(payload.type, sizeof(payload.type), "%s", type);
    payload.timestamp_ms = (int64_t)k_uptime_get();
    payload.temp_c = sensor_value_to_float(&temp_val);
    payload.accel_x_g = sensor_value_to_float(&accel_val[0]);
    payload.accel_y_g = sensor_value_to_float(&accel_val[1]);
    payload.accel_z_g = sensor_value_to_float(&accel_val[2]);

    uart_comm_send_sos(uart_dev, &payload);
}

static void sos_button_handler(const struct device *port, struct gpio_callback *cb, uint32_t pins)
{
    ARG_UNUSED(port);
    ARG_UNUSED(cb);
    ARG_UNUSED(pins);

    gpio_pin_set_dt(&led, 1);
    send_payload("SOS");
    k_msleep(150);
    gpio_pin_set_dt(&led, 0);
}

void main(void)
{
    printk("SOS IoT firmware starting (HARDWARIO TOWER/Core)...\n");

    if (init_peripherals() < 0) {
        printk("Init failed. Halting.\n");
        return;
    }

    while (1) {
        struct sensor_value accel_val[3];
        float ax = 0.0f, ay = 0.0f, az = 1.0f;

        if (sensors_read_accel(accel_val) == 0) {
            ax = sensor_value_to_float(&accel_val[0]);
            ay = sensor_value_to_float(&accel_val[1]);
            az = sensor_value_to_float(&accel_val[2]);
        }

        float magnitude = sqrtf((ax * ax) + (ay * ay) + (az * az));
        if (magnitude < FREEFALL_THRESHOLD_G) {
            printk("Free-fall detected. Triggering SOS.\n");
            send_payload("SOS");
        } else {
            send_payload("HEARTBEAT");
        }

        k_sleep(HEARTBEAT_INTERVAL);
    }
}
