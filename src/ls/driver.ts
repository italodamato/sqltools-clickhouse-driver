import AbstractDriver from "@sqltools/base-driver";
import queries from "./queries";
import {
  IConnectionDriver,
  MConnectionExplorer,
  NSDatabase,
  ContextValue,
  Arg0,
} from "@sqltools/types";
import sqltoolsRequire from "@sqltools/base-driver/dist/lib/require";
import { v4 as generateId } from "uuid";
import ClickHouse from "@apla/clickhouse";

type ClickHouseOptions = any;

export default class ClickHouseDriver
  extends AbstractDriver<ClickHouse, ClickHouseOptions>
  implements IConnectionDriver {
  queries = queries;

  public async open() {
    if (this.connection) {
      return this.connection;
    }

    let opts: ClickHouseOptions = {
      host: this.credentials.host,
      port: this.credentials.port,
      database: this.credentials.database,
      user: this.credentials.user,
      password: this.credentials.password,
      protocol: this.credentials.protocol,
    };

    this.connection = new ClickHouse(opts);
    return this.connection;
  }

  public async close() {
    if (!this.connection) return Promise.resolve();

    // ClickHouse connection is a http client, so we can just make it null.
    this.connection = null;
  }

  public query: typeof AbstractDriver["prototype"]["query"] = async (
    query,
    opt = {}
  ) => {
    return this.open().then((ch) => {
      return new Promise<NSDatabase.IResult[]>((resolve) => {
        ch.query(query, (err, data) => {
          if (err) {
            return this.resolveErr(resolve, err, query);
          }
          return this.resolveQueryResults(resolve, data, query);
        });
      });
    });
  };

  private resolveQueryResults(resolve, rows, query) {
    const cols: string[] = [];
    if (rows && rows.length > 0) {
      for (const colName in rows[0]) {
        cols.push(colName);
      }
    }

    const res = {
      connId: this.getId(),
      results: rows,
      cols: cols,
      query: query,
      messages: [],
    } as NSDatabase.IResult;

    return resolve([res]);
  }

  private resolveErr(resolve, err, query) {
    const messages: string[] = [];
    if (err.message) {
      messages.push(err.message);
    }

    return resolve([
      {
        connId: this.getId(),
        error: err,
        results: [],
        cols: [],
        query: query,
        messages: messages,
      } as NSDatabase.IResult,
    ]);
  }

  public async testConnection() {
    await this.open();

    const db = this.credentials.database;
    const dbFound = await this.query(`SHOW DATABASES LIKE '${db}'`, {});
    if (dbFound[0].error) {
      return Promise.reject({
        message: `Cannot get database list: ${dbFound[0].error}`,
      });
    }
    if (dbFound[0].results.length !== 1) {
      return Promise.reject({ message: `Cannot find ${db} database` });
    }
    await this.close();
  }

  /**
   * This method is a helper to generate the connection explorer tree.
   * it gets the child items based on current item
   */
  public async getChildrenForItem({
    item,
    parent,
  }: Arg0<IConnectionDriver["getChildrenForItem"]>) {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return <MConnectionExplorer.IChildItem[]>[
          {
            label: "Tables",
            type: ContextValue.RESOURCE_GROUP,
            iconId: "folder",
            childType: ContextValue.TABLE,
          },
          {
            label: "Views",
            type: ContextValue.RESOURCE_GROUP,
            iconId: "folder",
            childType: ContextValue.VIEW,
          },
        ];
      case ContextValue.TABLE:
      case ContextValue.VIEW:
        return this.queryResults(
          this.queries.fetchColumns(item as NSDatabase.ITable)
        );
      case ContextValue.RESOURCE_GROUP:
        return this.getChildrenForGroup({ item, parent });
    }
    return [];
  }

  /**
   * This method is a helper to generate the connection explorer tree.
   * It gets the child based on child types
   */
  private async getChildrenForGroup({
    item,
  }: Arg0<IConnectionDriver["getChildrenForItem"]>) {
    switch (item.childType) {
      case ContextValue.TABLE:
        return this.queryResults(
          this.queries.fetchTables(item as NSDatabase.ISchema)
        );
      case ContextValue.VIEW:
        return this.queryResults(
          this.queries.fetchViews(item as NSDatabase.ISchema)
        );
    }
    return [];
  }

  /**
   * This method is a helper for intellisense and quick picks.
   */
  public async searchItems(
    itemType: ContextValue,
    search: string,
    extraParams: any = {}
  ): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.TABLE:
        return this.queryResults(this.queries.searchTables({ search }));
      case ContextValue.COLUMN:
        return this.queryResults(
          this.queries.searchColumns({ search, ...extraParams })
        );
    }
    return [];
  }

  public getStaticCompletions: IConnectionDriver["getStaticCompletions"] = async () => {
    return {};
  };
}
