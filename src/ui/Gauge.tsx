export default function Gauge({ fields }: { fields: Record<string, string> }) {
    return (
        <>
            <h2>Gauge State</h2>
            <ul id="gauge-state">
                {Object.entries(fields).map(([name, status], i) => (
                    <li key={i}>
                        <div style={{ display: "flex" }}>
                            <pre>
                                {name}: {status}
                            </pre>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}
