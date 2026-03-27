#ifndef UART_COMM_H
#define UART_COMM_H

#include <stdint.h>
#include <zephyr/device.h>

typedef struct {
    char device_id[16];
    char type[12];
    int64_t timestamp_ms;
    float temp_c;
    float accel_x_g;
    float accel_y_g;
    float accel_z_g;
} sos_payload_t;

void uart_comm_init(const struct device *uart_dev);
void uart_comm_send_sos(const struct device *uart_dev, const sos_payload_t *payload);

#endif // UART_COMM_H
