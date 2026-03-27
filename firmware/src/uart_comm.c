// uart_comm.c - UART communication for SOS payloads to gateway
// JSON line protocol for Node-RED serial parser

#include <zephyr/kernel.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/printk.h>
#include <stdio.h>
#include <string.h>

#include "uart_comm.h"

#define TX_BUFFER_SIZE 256
static uint8_t tx_buffer[TX_BUFFER_SIZE];

void uart_comm_init(const struct device *uart_dev)
{
    ARG_UNUSED(uart_dev);
    printk("UART comm initialized\n");
}

void uart_comm_send_sos(const struct device *uart_dev, const sos_payload_t *payload)
{
    if (uart_dev == NULL || payload == NULL) {
        printk("UART send skipped (null arg)\n");
        return;
    }

    int len = snprintk((char *)tx_buffer, TX_BUFFER_SIZE,
        "{\"device_id\":\"%s\",\"type\":\"%s\",\"timestamp\":%lld,"
        "\"temp\":%.2f,\"accel_x\":%.3f,\"accel_y\":%.3f,\"accel_z\":%.3f}\n",
        payload->device_id,
        payload->type,
        payload->timestamp_ms,
        (double)payload->temp_c,
        (double)payload->accel_x_g,
        (double)payload->accel_y_g,
        (double)payload->accel_z_g);

    if (len <= 0 || len >= TX_BUFFER_SIZE) {
        printk("Payload encode failed\n");
        return;
    }

    int offset = 0;
    while (offset < len) {
        int sent = uart_fifo_fill(uart_dev, &tx_buffer[offset], len - offset);
        if (sent <= 0) {
            k_msleep(2);
            continue;
        }
        offset += sent;
    }

    printk("UART TX: %s", (char *)tx_buffer);
}
