/** Green alert shown after a device is created, pointing to the Show registration code button. */
export default function CodeBanner({ onDismiss }) {
    return (
        <div className="alert alert-success d-flex align-items-center justify-content-between mb-3">
            <span>
                ✅ <strong>Device created!</strong>{' '}
                Click <strong>Show registration code</strong> on the device card to view the code.
            </span>
            <button type="button" className="btn-close ms-3" onClick={onDismiss} aria-label="Close" />
        </div>
    );
}
