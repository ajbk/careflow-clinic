import type Database from "better-sqlite3";

/** Validate historical snapshots against their signed source, including invalidated attempts.
 * Current catalog values, lot status/expiry and staff roles can change after handoff. */
export function assertFulfillmentIntegrity(sqlite: Database.Database): void {
  const checks: Record<string, string> = {
    labels: `SELECT 1 FROM fulfillment_label_versions l
      JOIN medication_decisions d ON d.id=l.medication_decision_id JOIN visits v ON v.id=l.visit_id
      WHERE d.kind<>'ORDER' OR d.visit_id<>l.visit_id OR d.version<>l.medication_decision_version OR v.clinic_id<>l.clinic_id
        OR NOT EXISTS (SELECT 1 FROM medication_order_items i WHERE i.medication_decision_id=d.id)
        OR (SELECT count(*) FROM fulfillment_label_items i WHERE i.label_version_id=l.id)
          <> (SELECT count(*) FROM medication_order_items i WHERE i.medication_decision_id=d.id)`,
    labelItems: `SELECT 1 FROM fulfillment_label_items l JOIN fulfillment_label_versions v ON v.id=l.label_version_id
      JOIN medication_order_items i ON i.id=l.medication_order_item_id
      WHERE i.medication_decision_id<>v.medication_decision_id OR l.position<>i.position OR l.medication_id<>i.medication_id
        OR l.medication_revision<>i.medication_revision OR l.quantity<>i.quantity OR l.display_name_snapshot<>i.display_name_snapshot
        OR l.strength_snapshot<>i.strength_snapshot OR l.dosage_form_snapshot<>i.dosage_form_snapshot
        OR l.unit_snapshot<>i.unit_snapshot OR l.directions_th_snapshot<>i.directions_th`,
    reservations: `SELECT 1 FROM inventory_reservations r JOIN medication_decisions d ON d.id=r.medication_decision_id
      JOIN visits v ON v.id=r.visit_id WHERE d.kind<>'ORDER' OR d.visit_id<>r.visit_id OR d.version<>r.medication_decision_version
        OR r.clinic_id<>v.clinic_id OR NOT EXISTS (SELECT 1 FROM inventory_reservation_allocations a WHERE a.reservation_id=r.id)
        OR EXISTS (SELECT 1 FROM medication_order_items i WHERE i.medication_decision_id=d.id AND i.quantity<>
          COALESCE((SELECT sum(a.quantity) FROM inventory_reservation_allocations a WHERE a.reservation_id=r.id AND a.medication_order_item_id=i.id),0))`,
    allocations: `SELECT 1 FROM inventory_reservation_allocations a JOIN inventory_reservations r ON r.id=a.reservation_id
      JOIN medication_order_items i ON i.id=a.medication_order_item_id JOIN inventory_lots l ON l.id=a.lot_id
      WHERE i.medication_decision_id<>r.medication_decision_id OR a.medication_id<>i.medication_id
        OR a.medication_id<>l.medication_id OR r.clinic_id<>l.clinic_id OR a.unit_snapshot<>i.unit_snapshot`,
    preparations: `SELECT 1 FROM fulfillment_preparations p JOIN inventory_reservations r ON r.id=p.reservation_id
      JOIN fulfillment_label_versions l ON l.id=p.label_version_id
      WHERE p.clinic_id<>r.clinic_id OR p.visit_id<>r.visit_id OR p.medication_decision_id<>r.medication_decision_id
        OR p.medication_decision_version<>r.medication_decision_version OR p.clinic_id<>l.clinic_id OR p.visit_id<>l.visit_id
        OR p.medication_decision_id<>l.medication_decision_id OR p.medication_decision_version<>l.medication_decision_version
        OR (p.status='COMPLETED' AND EXISTS (SELECT 1 FROM inventory_reservation_allocations a WHERE a.reservation_id=r.id
          AND NOT EXISTS (SELECT 1 FROM fulfillment_preparation_confirmations c WHERE c.preparation_id=p.id AND c.reservation_allocation_id=a.id)))`,
    confirmations: `SELECT 1 FROM fulfillment_preparation_confirmations c JOIN fulfillment_preparations p ON p.id=c.preparation_id
      JOIN inventory_reservation_allocations a ON a.id=c.reservation_allocation_id
      WHERE a.reservation_id<>p.reservation_id OR c.medication_order_item_id<>a.medication_order_item_id OR c.medication_id<>a.medication_id
        OR c.lot_id<>a.lot_id OR c.quantity<>a.quantity OR (c.method='BARCODE' AND NOT EXISTS
          (SELECT 1 FROM fulfillment_label_items l WHERE l.label_version_id=p.label_version_id AND l.medication_order_item_id=c.medication_order_item_id AND l.internal_barcode_snapshot=c.barcode_snapshot))`,
    releases: `SELECT 1 FROM fulfillment_releases r JOIN fulfillment_preparations p ON p.id=r.preparation_id
      JOIN fulfillment_label_print_events e ON e.id=r.label_print_event_id
      WHERE p.status<>'COMPLETED' OR r.clinic_id<>p.clinic_id OR r.visit_id<>p.visit_id
        OR r.medication_decision_id<>p.medication_decision_id OR r.medication_decision_version<>p.medication_decision_version
        OR r.label_version_id<>p.label_version_id OR r.reservation_id<>p.reservation_id OR r.preparation_revision<>p.revision
        OR e.label_version_id<>p.label_version_id OR e.sequence<p.minimum_print_sequence`,
    rejections: `SELECT 1 FROM fulfillment_rejections r JOIN fulfillment_preparations p ON p.id=r.preparation_id
      WHERE p.status<>'COMPLETED' OR r.clinic_id<>p.clinic_id OR r.visit_id<>p.visit_id OR r.label_version_id<>p.label_version_id
        OR r.reservation_id<>p.reservation_id OR NOT EXISTS (SELECT 1 FROM fulfillment_label_print_events e
          WHERE e.label_version_id=r.label_version_id AND e.sequence=r.print_sequence_at_rejection)
        OR NOT EXISTS (SELECT 1 FROM fulfillment_artifact_invalidations i WHERE i.artifact_type='PREPARATION' AND i.artifact_id=p.id AND i.trigger='REJECT')`,
    invalidations: `SELECT 1 FROM fulfillment_artifact_invalidations i LEFT JOIN (
        SELECT 'LABEL' AS type,id,clinic_id,visit_id FROM fulfillment_label_versions UNION ALL
        SELECT 'PREPARATION',id,clinic_id,visit_id FROM fulfillment_preparations UNION ALL
        SELECT 'RELEASE',id,clinic_id,visit_id FROM fulfillment_releases
      ) a ON a.type=i.artifact_type AND a.id=i.artifact_id
      WHERE a.id IS NULL OR i.clinic_id<>a.clinic_id OR i.visit_id<>a.visit_id OR (i.replacement_decision_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM medication_decisions d WHERE d.id=i.replacement_decision_id AND d.visit_id=i.visit_id))`,
    dispenses: `SELECT 1 FROM fulfillment_dispenses d JOIN fulfillment_releases r ON r.id=d.release_id
      JOIN inventory_reservations v ON v.id=d.reservation_id
      WHERE d.clinic_id<>r.clinic_id OR d.visit_id<>r.visit_id OR d.medication_decision_id<>r.medication_decision_id
        OR d.medication_decision_version<>r.medication_decision_version OR d.label_version_id<>r.label_version_id
        OR d.preparation_id<>r.preparation_id OR d.reservation_id<>r.reservation_id
        OR v.status<>'CONSUMED' OR v.consumed_dispense_id IS NOT d.id OR v.consumed_at IS NOT d.handed_off_at OR v.consumed_by IS NOT d.handed_off_by
        OR EXISTS (SELECT 1 FROM fulfillment_artifact_invalidations i WHERE
          (i.artifact_type='LABEL' AND i.artifact_id=d.label_version_id) OR (i.artifact_type='PREPARATION' AND i.artifact_id=d.preparation_id) OR (i.artifact_type='RELEASE' AND i.artifact_id=d.release_id))
        OR EXISTS (SELECT 1 FROM inventory_reservation_allocations a WHERE a.reservation_id=d.reservation_id AND NOT EXISTS
          (SELECT 1 FROM fulfillment_dispense_lines l WHERE l.dispense_id=d.id AND l.reservation_allocation_id=a.id))`,
    dispenseLines: `SELECT 1 FROM fulfillment_dispense_lines l JOIN fulfillment_dispenses d ON d.id=l.dispense_id
      JOIN inventory_reservation_allocations a ON a.id=l.reservation_allocation_id JOIN medication_order_items i ON i.id=l.medication_order_item_id
      WHERE a.reservation_id<>d.reservation_id OR l.medication_order_item_id<>a.medication_order_item_id OR l.medication_id<>a.medication_id
        OR l.lot_id<>a.lot_id OR l.quantity<>a.quantity OR l.lot_number_snapshot<>a.lot_number_snapshot OR l.expiry_date_snapshot<>a.expiry_date_snapshot
        OR l.display_name_snapshot<>i.display_name_snapshot OR l.strength_snapshot<>i.strength_snapshot OR l.dosage_form_snapshot<>i.dosage_form_snapshot
        OR l.unit_snapshot<>i.unit_snapshot OR l.directions_th_snapshot<>i.directions_th
        OR 1<>(SELECT count(*) FROM inventory_stock_movements m WHERE m.source_type='DISPENSE' AND m.source_id=l.id)
        OR NOT EXISTS (SELECT 1 FROM inventory_stock_movements m WHERE m.source_type='DISPENSE' AND m.source_id=l.id AND m.lot_id=l.lot_id AND m.quantity_delta=-l.quantity AND m.clinic_id=d.clinic_id AND m.movement_type='DISPENSE')`,
    stockSources: `SELECT 1 FROM inventory_stock_movements m WHERE m.source_type='DISPENSE' AND NOT EXISTS
      (SELECT 1 FROM fulfillment_dispense_lines l WHERE l.id=m.source_id)`,
  };
  for (const [name, query] of Object.entries(checks)) {
    if (sqlite.prepare(`${query} LIMIT 1`).get()) throw new Error(`Fulfillment evidence verification failed: ${name}`);
  }
}
