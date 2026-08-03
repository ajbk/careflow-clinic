export function PilotUnavailableScreen({ title }: { title: string }) {
  return (
    <section className="care-card empty-state" aria-labelledby="pilot-unavailable-title">
      <h1 id="pilot-unavailable-title">{title}</h1>
      <p>ส่วนนี้ยังไม่เปิดใช้ใน Pilot milestone ปัจจุบัน</p>
    </section>
  );
}
