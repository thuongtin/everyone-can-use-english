import {
  AfterUpdate,
  AfterDestroy,
  BelongsTo,
  Table,
  Column,
  Default,
  IsUUID,
  Model,
  DataType,
  AfterCreate,
  AllowNull,
} from "sequelize-typescript";
import mainWindow from "@main/window";
import { Segment } from "@main/db/models";

@Table({
  modelName: "Note",
  tableName: "notes",
  underscored: true,
  timestamps: true,
})
export class Note extends Model<Note> {
  @IsUUID("all")
  @Default(DataType.UUIDV4)
  @Column({ primaryKey: true, type: DataType.UUID })
  id: string;

  @Column(DataType.UUID)
  targetId: string;

  @Column(DataType.STRING)
  targetType: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  content: string;

  @Default({})
  @Column(DataType.JSON)
  parameters: any;

  @Column(DataType.DATE)
  syncedAt: Date;

  @BelongsTo(() => Segment, { foreignKey: "targetId", constraints: false })
  segment: Segment;

  @Column(DataType.VIRTUAL)
  get isSynced(): boolean {
    return Boolean(this.syncedAt) && this.syncedAt >= this.updatedAt;
  }

  @AfterCreate
  static notifyForCreate(note: Note) {
    this.notify(note, "create");
  }

  @AfterUpdate
  static notifyForUpdate(note: Note) {
    this.notify(note, "update");
  }

  @AfterDestroy
  static notifyForDestroy(note: Note) {
    this.notify(note, "destroy");
  }

  static async notify(note: Note, action: "create" | "update" | "destroy") {
    if (!mainWindow.win) return;

    const segment = await Segment.findOne({ where: { id: note.targetId } });
    const record = note.toJSON();

    if (segment) {
      record.segment = segment.toJSON();
    }
    mainWindow.win.webContents.send("db-on-transaction", {
      model: "Note",
      id: note.id,
      action,
      record,
    });
  }
}
